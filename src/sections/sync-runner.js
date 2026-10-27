/* Canvas Gradebook+ - copying items to linked sections: what is there now,
 * and doing the copy.
 *
 * survey()  looks at each linked section before anything is written: is the
 *           item already there (and was that copy changed there since?), is
 *           there a same-titled item from somewhere else that a copy would
 *           duplicate, which module and assignment group a copy belongs in.
 * run()     copies one item into one section and then gives the copy that
 *           section's dates, note and published state.
 *
 * The order inside run() is what makes it reliable:
 *   1. Canvas's own selective course copy (core/section-sync.js copyRequest).
 *   2. Wait for that job to finish - Canvas runs copies into one course one
 *      at a time, so a job can sit queued behind another.
 *   3. Ask Canvas where the copy is (asset_id_mapping). Never guessed from a
 *      title: a section can hold another item with the same name.
 *   4. Dates, through the same date_details call Canvas's Assign To tray
 *      makes; the note; the published state. Each step is checked, and one
 *      that Canvas refuses is reported against that section and item.
 * A job is written to this computer (chrome.storage.local) as soon as Canvas
 * has accepted it, and removed only once step 4 is done, so a tab closed
 * while Canvas is still copying finishes the job the next time a Canvas
 * course page opens (resumePending). */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});
  if (CGP.SectionCopier) return;

  var JOB_PREFIX = 'cgp.sections.job.';
  var FP_PREFIX = 'cgp.sections.fp.';
  var JOB_MAX_AGE_MS = 3 * 24 * 3600 * 1000;
  var CLAIM_MS = 2 * 60 * 1000;

  function S() { return CGP.sectionSync; }

  /* chrome.storage.local, or an in-memory stand-in (tests, or a page with no
   * extension storage). One key per job and per tracked copy, so two tabs
   * never overwrite each other's entries. */
  function defaultStore() {
    var local = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    if (local) {
      return {
        get: function (key) { return local.get(key).then(function (r) { return r || {}; }); },
        set: function (obj) { return local.set(obj); },
        remove: function (keys) { return local.remove(keys); }
      };
    }
    var mem = {};
    return {
      get: function (key) {
        if (key === null) return Promise.resolve(Object.assign({}, mem));
        var out = {};
        [].concat(key).forEach(function (k) { if (k in mem) out[k] = mem[k]; });
        return Promise.resolve(out);
      },
      set: function (obj) { Object.assign(mem, obj); return Promise.resolve(); },
      remove: function (keys) { [].concat(keys).forEach(function (k) { delete mem[k]; }); return Promise.resolve(); }
    };
  }

  function SectionCopier(opts) {
    opts = opts || {};
    this.api = opts.api;
    this.origin = opts.origin || (typeof location !== 'undefined' ? location.origin : '');
    this.store = opts.store || defaultStore();
    this.sleep = opts.sleep || CGP.util.sleep;
    this.now = opts.now || function () { return Date.now(); };
    this.pollMs = opts.pollMs || 1500;
    this.maxWaitMs = opts.maxWaitMs || 20 * 60 * 1000;
    this.tabId = Math.random().toString(36).slice(2);
  }

  var P = SectionCopier.prototype;

  function describe(err, fallback) {
    if (err && err.status === 404) return (fallback || 'Canvas could not find it') + ' (Canvas 404).';
    var msg = CGP.util.describeApiError(err, { fallback: fallback });
    if (err && err.canvasMessage && msg.indexOf(err.canvasMessage) < 0 && !CGP.util.isPermissionDeniedError(err)) {
      msg += ' Canvas said: ' + err.canvasMessage;
    }
    return msg;
  }

  /* ------------------------------------------------------------- survey */

  /* What every linked section has, for every chosen item. Nothing is
   * written. Per destination:
   *   {courseId, error, mappingFrom, items: {itemKey: {...}}}
   * and per item in it:
   *   {destId, status: 'new'|'restore'|'same'|'stale'|'edited'|'differs',
   *    note, lookalike, module, assignmentGroupId, groupMissing}
   * `source` carries what is read once from the source course. */
  P.survey = function (srcCourseId, items, destCourseIds, opts) {
    var self = this;
    opts = opts || {};
    var sync = S();
    var src = { modules: null, groups: null };
    var needModules = !!opts.placeInModules && items.some(function (it) { return sync.TYPES[it.type].insert; });
    var needGroups = items.some(function (it) { return it.type === 'assignment' || it.type === 'quiz' || (it.type === 'discussion' && it.graded); });

    var sourceReads = Promise.all([
      needModules ? this.api.modulesWithItems(srcCourseId).catch(function () { return null; }) : null,
      needGroups ? this.api.assignmentGroups(srcCourseId).catch(function () { return null; }) : null,
      Promise.all(items.map(function (it) { return self.ensureSourceHtml(srcCourseId, it); }))
    ]).then(function (r) {
      src.modules = r[0];
      src.groups = r[1];
      src.moduleIndex = r[0] ? sync.moduleIndex(r[0]) : null;
    });

    return sourceReads.then(function () {
      var gate = CGP.util.pool(3);
      return Promise.all(destCourseIds.map(function (destId) {
        return gate(function () { return self.surveyOne(srcCourseId, items, String(destId), src, opts); });
      }));
    }).then(function (dests) { return { source: src, dests: dests }; });
  };

  /* The source item's instructions, read once (lists leave them out). */
  P.ensureSourceHtml = function (srcCourseId, item) {
    if (!S().TYPES[item.type].body || item.htmlLoaded) return Promise.resolve(item);
    return this.api.sectionItem(srcCourseId, item.type, item.id).then(function (o) {
      var full = S().toItem(item.type === 'announcement' ? 'discussion' : item.type, o);
      if (full) item.html = full.html;
      item.htmlLoaded = true;
      return item;
    }, function () { return item; });
  };

  P.surveyOne = function (srcCourseId, items, destId, src, opts) {
    var self = this;
    var sync = S();
    var out = { courseId: destId, error: null, mappingFrom: null, items: {} };
    var mapping = {};
    var cache = {};
    function listOf(type) {
      if (!cache[type]) cache[type] = self.api.courseItems(destId, type).catch(function () { return []; });
      return cache[type];
    }

    return this.api.contentMigrations(destId).then(function (migs) {
      var last = sync.latestCopyFrom(migs, srcCourseId);
      if (!last) return null;
      out.mappingFrom = String(last.id);
      return self.api.assetIdMapping(destId, last.id).then(function (m) { mapping = m || {}; });
    }).then(function () {
      var reads = [];
      if (src.moduleIndex) reads.push(listOf('module').then(function (mods) { out.modules = mods; }));
      if (src.groups) reads.push(self.api.assignmentGroups(destId).then(function (g) { out.groups = g || []; }, function () { out.groups = null; }));
      return Promise.all(reads);
    }).then(function () {
      return Promise.all(items.map(function (item) {
        return self.surveyItem(srcCourseId, item, destId, mapping, src, out, listOf, opts).then(function (info) {
          out.items[item.type + ':' + item.id] = info;
        });
      }));
    }).then(function () {
      out.mapping = mapping;
      return out;
    }, function (err) {
      out.error = CGP.util.isPermissionDeniedError(err)
        ? 'You can’t add content to this course in Canvas (your role there may not allow it, or the course has concluded).'
        : describe(err, 'Couldn’t read this section from Canvas');
      return out;
    });
  };

  P.surveyItem = function (srcCourseId, item, destCourseId, mapping, src, dest, listOf, opts) {
    var self = this;
    var sync = S();
    var info = { destId: null, status: 'new', note: '', lookalike: null, module: null, moduleWanted: null, assignmentGroupId: null, groupMissing: null };

    // Module placement for a first copy (a copy already there stays put).
    if (src.moduleIndex && sync.TYPES[item.type].insert) {
      var key = item.type + ':' + item.id;
      var places = src.moduleIndex[key] || (item.url ? src.moduleIndex['pageurl:' + item.url] : null) || [];
      if (places.length) {
        info.moduleWanted = places[0].moduleName;
        info.module = sync.destModuleFor(places[0], mapping, dest.modules || []);
      }
    }
    // Assignment group for a first copy, matched by name.
    if (src.groups && item.assignmentGroupId && dest.groups) {
      var sg = src.groups.filter(function (g) { return String(g.id) === String(item.assignmentGroupId); })[0];
      if (sg) {
        var want = String(sg.name || '').trim().toLowerCase();
        var dg = dest.groups.filter(function (g) { return String(g.name || '').trim().toLowerCase() === want; });
        if (dg.length === 1) info.assignmentGroupId = String(dg[0].id);
        else info.groupMissing = sg.name || '';
      }
    }

    var destId = sync.destIdFor(mapping, item.type, item.id);
    if (item.type === 'module' && destId) return this.surveyModule(srcCourseId, item, destCourseId, destId, mapping, info);
    if (!destId) {
      return listOf(item.type).then(function (list) {
        var mine = (list || []).map(function (o) { return sync.toItem(item.type, o) || { title: o.title || o.name }; });
        var hit = sync.lookalike(mine, item.title);
        if (hit) info.lookalike = { id: hit.id, title: hit.title };
        return info;
      });
    }
    info.destId = destId;
    return this.api.sectionItem(destCourseId, item.type, destId).then(function (o) {
      // Canvas keeps a deleted copy in its records (and its mapping); copying
      // again restores it. Reading one answers 404, or reports it deleted.
      if (!o || o.workflow_state === 'deleted') { info.status = 'restore'; return info; }
      var d = sync.toItem(item.type === 'announcement' ? 'discussion' : item.type, o) || {};
      info.destTitle = d.title;
      info.destDates = d.dates || {};
      info.destPublished = d.published;
      // The copy's dates as Canvas's Assign To has them - the same place
      // they are written - so updating it starts from that section's own.
      var pageDates = sync.TYPES[item.type].datesVia === 'details' && sync.dateFields(item).length
        ? self.api.dateDetails(destCourseId, item.type, destId).then(function (dd) {
          var got = {};
          sync.dateFields(item).forEach(function (f) { got[f] = (dd && dd[f]) || null; });
          info.destDates = got;
        }, function () { if (item.type === 'page') info.destDates = null; })
        : Promise.resolve();
      if (!sync.TYPES[item.type].body) { info.status = 'same'; return pageDates.then(function () { return info; }); }
      var split = sync.splitNote(d.html || '');
      info.note = split.note;
      return pageDates.then(function () { return self.baseline(srcCourseId, item, destCourseId); }).then(function (fp) {
        info.status = sync.compareCopy(item.html || '', d.html || '', fp);
        return info;
      });
    }, function (err) {
      if (err && err.status === 404) { info.status = 'restore'; return info; }
      throw err;
    });
  };

  /* Copying a module again copies everything in it again, so a module's
   * copy counts as changed there when any of its items' copies was. */
  P.surveyModule = function (srcCourseId, item, destCourseId, destId, mapping, info) {
    var self = this;
    var sync = S();
    info.destId = destId;
    return this.api.sectionItem(destCourseId, 'module', destId).then(function (o) {
      if (!o || o.workflow_state === 'deleted') { info.status = 'restore'; return info; }
      info.destTitle = o.name;
      var kids = (item.children || []).filter(function (c) { return sync.TYPES[c.type].body; });
      return Promise.all(kids.map(function (c) {
        var cid = sync.destIdFor(mapping, c.type, c.id);
        if (!cid) return null;
        return self.api.sectionItem(destCourseId, c.type, cid).then(function (co) {
          var d = sync.toItem(c.type, co) || {};
          info.childDates = info.childDates || {};
          info.childDates[c.type + ':' + c.id] = d.dates || {};
          var dates = self.api.dateDetails(destCourseId, c.type, cid).then(function (dd) {
            var got = {};
            sync.dateFields(d.type ? d : c).forEach(function (f) { got[f] = (dd && dd[f]) || null; });
            info.childDates[c.type + ':' + c.id] = got;
          }, function () { /* the item's own fields stand */ });
          var note = sync.splitNote(d.html || '').note;
          if (note) (info.childNotes = info.childNotes || {})[c.type + ':' + c.id] = note;
          return dates.then(function () { return self.baseline(srcCourseId, c, destCourseId); }).then(function (fp) {
            var st = sync.compareCopy(c.html || '', d.html || '', fp);
            return (st === 'edited' || st === 'differs') ? { title: c.title, status: st } : null;
          });
        }, function () { return null; });
      })).then(function (changed) {
        changed = changed.filter(Boolean);
        info.changedChildren = changed.map(function (c) { return c.title; });
        info.status = !changed.length ? 'same'
          : (changed.some(function (c) { return c.status === 'edited'; }) ? 'edited' : 'differs');
        return info;
      });
    }, function (err) {
      if (err && err.status === 404) { info.status = 'restore'; return info; }
      throw err;
    });
  };

  /* ---------------------------------------------------- copy fingerprints */

  /* The record of each copy - a fingerprint of its instructions as copied -
   * is kept in two places: this computer (chrome.storage.local), and the
   * teacher's own Canvas user data (custom_data), so a copy made on one
   * computer is recognised on every other. Canvas's is the one that counts
   * when both exist and differ (the newer of the two wins); a computer that
   * cannot reach it still has its own. Scope: fp/<src>/<type>_<id>/<dest>. */
  P.trackKey = function (srcCourseId, item, destCourseId) {
    return FP_PREFIX + S().trackKey(this.origin, srcCourseId, item.type, item.id, destCourseId);
  };

  function recordScope(srcCourseId, item, destCourseId) {
    return 'fp/' + encodeURIComponent(String(srcCourseId)) + '/' + item.type + '_' + encodeURIComponent(String(item.id)) +
      (destCourseId === undefined ? '' : '/' + encodeURIComponent(String(destCourseId)));
  }

  /* Every record of one source item, all destinations: {destCourseId: rec}.
   * One Canvas read per item per page, shared by every look at it. */
  P.records = function (srcCourseId, item) {
    var self = this;
    var memo = this._records || (this._records = {});
    var key = srcCourseId + '|' + item.type + ':' + item.id;
    if (memo[key]) return memo[key];
    var canvas = this.api && this.api.customData
      ? this.api.customData(recordScope(srcCourseId, item)).catch(function () { return null; })
      : Promise.resolve(null);
    memo[key] = canvas.then(function (remote) { return remote && typeof remote === 'object' ? remote : {}; });
    return memo[key];
  };

  P.record = function (srcCourseId, item, destCourseId) {
    var k = this.trackKey(srcCourseId, item, destCourseId);
    var local = this.store.get(k).then(function (r) { return (r && r[k]) || null; }, function () { return null; });
    return Promise.all([local, this.records(srcCourseId, item)]).then(function (r) {
      var mine = r[0];
      var theirs = r[1][String(destCourseId)] || null;
      if (theirs && (!mine || Number(theirs.at || 0) >= Number(mine.at || 0))) return theirs;
      return mine;
    });
  };

  P.baseline = function (srcCourseId, item, destCourseId) {
    return this.record(srcCourseId, item, destCourseId).then(function (rec) { return (rec && rec.fp) || null; });
  };

  P.remember = function (srcCourseId, item, destCourseId, destId, html) {
    var self = this;
    var k = this.trackKey(srcCourseId, item, destCourseId);
    var rec = { fp: S().fingerprint(html || ''), destId: String(destId), at: this.now() };
    var v = {};
    v[k] = rec;
    if (this._records) delete this._records[srcCourseId + '|' + item.type + ':' + item.id];
    var local = this.store.set(v).catch(function () { return null; });
    var canvas = this.api && this.api.setCustomData
      ? this.api.setCustomData(recordScope(srcCourseId, item, destCourseId), rec).catch(function () {
        CGP.diag.warn('sections.recordNotShared');
        return null;
      })
      : Promise.resolve();
    return Promise.all([local, canvas]).then(function () { return rec; });
  };

  /* ---------------------------------------------------------------- run */

  /* task: {
   *   srcCourseId, destCourseId, item, mode: 'copy' | 'keep',
   *   dates: {field: iso|null},              (the item's own dates)
   *   children: [{type, id, title, dates}],  (a module's items)
   *   note: string,                          (this section's note; '' none)
   *   publish: 'match' | 'published' | 'unpublished',
   *   module: {id, position} | null,         (first copy only)
   *   assignmentGroupId: string | null,      (first copy only)
   *   destId: string | null                  (an existing copy, for 'keep')
   * }
   * Resolves {ok, destId, url, warnings, pending, error}; never rejects. */
  P.run = function (task, onStep) {
    var self = this;
    onStep = onStep || function () {};
    var result = { ok: false, destId: null, url: null, warnings: [], pending: false, error: null };

    if (task.mode === 'keep') {
      if (!task.destId) { result.error = 'There is no copy in this section to update.'; return Promise.resolve(result); }
      onStep('Updating dates');
      return this.finish(task, task.destId, task.mapping || {}, result, onStep).then(function () { return result; }, function (err) {
        result.ok = false;
        result.error = 'Something went wrong: ' + String(err && err.message);
        return result;
      });
    }

    var body;
    try {
      body = S().copyRequest(task.srcCourseId, task.item, {
        module: task.module, assignmentGroupId: task.assignmentGroupId
      });
    } catch (e) { result.error = String(e.message); return Promise.resolve(result); }

    onStep('Starting Canvas’s copy');
    return this.api.startCourseCopy(task.destCourseId, body).then(function (mig) {
      if (!mig || !mig.id) {
        result.error = 'Canvas did not start the copy.';
        return result;
      }
      var job = self.jobFor(task, mig.id);
      return self.saveJob(job).then(function () { return self.continueJob(job, result, onStep); });
    }, function (err) {
      result.error = describe(err, 'Canvas refused to start the copy');
      return result;
    }).then(null, function (err) {
      // Never reached by design; a bug here must still not leave a caller waiting.
      result.ok = false;
      result.error = result.error || ('Something went wrong: ' + String(err && err.message));
      return result;
    });
  };

  P.jobFor = function (task, migrationId) {
    return {
      id: task.destCourseId + '-' + migrationId,
      origin: this.origin,
      startedAt: this.now(),
      migrationId: String(migrationId),
      task: {
        srcCourseId: String(task.srcCourseId), destCourseId: String(task.destCourseId),
        destName: task.destName || '', mode: 'copy',
        item: { type: task.item.type, id: String(task.item.id), title: task.item.title || '', graded: !!task.item.graded,
          published: !!task.item.published, html: task.item.html || '', noDates: !!task.item.noDates,
          newQuiz: !!task.item.newQuiz, url: task.item.url || '' },
        dates: task.dates || {}, children: task.children || [], childNotes: task.childNotes || {},
        note: task.note || '', publish: task.publish || 'match'
      }
    };
  };

  P.saveJob = function (job) {
    job.claimedBy = this.tabId;
    job.claimedAt = this.now();
    var v = {};
    v[JOB_PREFIX + job.id] = job;
    return this.store.set(v).catch(function () { return null; });
  };

  P.dropJob = function (job) {
    return this.store.remove(JOB_PREFIX + job.id).catch(function () { return null; });
  };

  /* Wait for Canvas's copy job, find the copy, apply the section's settings. */
  P.continueJob = function (job, result, onStep, opts) {
    var self = this;
    var task = job.task;
    opts = opts || {};
    onStep('Canvas is copying');
    return this.waitFor(task.destCourseId, job.migrationId, opts.maxWaitMs || this.maxWaitMs, job).then(function (mig) {
      var state = S().migrationState(mig);
      if (state === 'running') {
        result.pending = true;
        result.error = 'Canvas is still copying this. Gradebook+ will finish setting its dates the next time you open a Canvas course page.';
        return result;
      }
      if (state !== 'completed') {
        return self.issues(task.destCourseId, job.migrationId).then(function (issues) {
          result.error = 'Canvas could not copy it' + (issues.length ? ': ' + issues.slice(0, 2).join(' ') : '.');
          return self.dropJob(job).then(function () { return result; });
        });
      }
      onStep('Finding the copy');
      return self.api.assetIdMapping(task.destCourseId, job.migrationId).then(function (mapping) {
        var destId = S().destIdFor(mapping, task.item.type, task.item.id);
        if (!destId) {
          result.error = 'Canvas finished, but did not report where the copy is. Check this section before copying again.';
          return self.dropJob(job).then(function () { return result; });
        }
        return self.settled(task, destId, opts.maxWaitMs || self.maxWaitMs).then(function (ready) {
          if (ready === 'failed') {
            result.error = 'Canvas could not finish importing the copy (its New Quizzes step failed). Check this section.';
            return self.dropJob(job).then(function () { return result; });
          }
          if (ready !== 'ready') {
            result.pending = true;
            result.error = 'Canvas is still importing this copy. Gradebook+ will finish setting its dates the next time you open a Canvas course page.';
            return result;
          }
          return self.issues(task.destCourseId, job.migrationId).then(function (issues) {
            issues.forEach(function (t) { result.warnings.push('Canvas: ' + t); });
            return self.finish(task, destId, mapping, result, onStep);
          }).then(function () { return self.dropJob(job); }).then(function () { return result; });
        });
      });
    }).then(null, function (err) {
      // Canvas could not be asked (a network failure, a throttle, the job's
      // state or mapping refused): the job stays saved to try again later.
      result.ok = false;
      result.pending = true;
      result.error = describe(err, 'Lost track of Canvas’s copy job') + ' Gradebook+ will check on it again later.';
      return result;
    });
  };

  /* A New Quiz (an assignment) is still being filled in by Canvas's quiz
   * service after the course copy itself reports completed: the copy sits
   * in "importing" until then, and a publish sent meanwhile would show
   * students an empty quiz. Wait for it. 'ready' | 'failed' | 'waiting'. */
  var BUSY_STATES = ['importing', 'duplicating', 'migrating', 'outcome_alignment_cloning'];
  var FAILED_STATES = ['fail_to_import', 'failed_to_duplicate', 'failed_to_migrate', 'failed_to_clone_outcome_alignment'];
  P.settled = function (task, destId, maxWaitMs) {
    var self = this;
    if (task.item.type !== 'assignment') return Promise.resolve('ready');
    var started = this.now();
    var n = 0;
    function check() {
      return self.api.sectionItem(task.destCourseId, 'assignment', destId).then(function (o) {
        var st = String((o && o.workflow_state) || '');
        if (FAILED_STATES.indexOf(st) >= 0) return 'failed';
        if (BUSY_STATES.indexOf(st) < 0) return 'ready';
        if (self.now() - started >= maxWaitMs) return 'waiting';
        n++;
        return self.sleep(Math.min(6000, self.pollMs + n * 250)).then(check);
      });
    }
    return check();
  };

  P.waitFor = function (courseId, migrationId, maxWaitMs, job) {
    var self = this;
    var started = this.now();
    var claimed = started;
    var n = 0;
    function check() {
      // Keep this tab's claim on the job fresh, so another tab opened
      // meanwhile does not start finishing it too.
      if (job && self.now() - claimed > CLAIM_MS / 2) { claimed = self.now(); self.saveJob(job); }
      return self.api.contentMigration(courseId, migrationId).then(function (m) {
        var state = S().migrationState(m);
        if (state === 'completed' || state === 'failed' || state === 'stuck') return m;
        if (self.now() - started >= maxWaitMs) return m;
        n++;
        return self.sleep(Math.min(6000, self.pollMs + n * 250)).then(check);
      });
    }
    return check();
  };

  /* Canvas's own warnings about a copy (a link to something not copied, a
   * file it could not bring), as one line each. Never fails the copy. */
  P.issues = function (courseId, migrationId) {
    return this.api.migrationIssues(courseId, migrationId).then(function (list) {
      return (list || []).filter(function (i) { return i && i.workflow_state !== 'resolved'; }).map(function (i) {
        return String(i.description || i.error_message || 'an issue').replace(/\s+/g, ' ').trim();
      });
    }, function () { return []; });
  };

  /* Steps 4+: everything the section gets on top of Canvas's copy. */
  P.finish = function (task, destId, mapping, result, onStep) {
    var self = this;
    var sync = S();
    var item = task.item;
    result.destId = String(destId);
    result.url = sync.itemHtmlPath(task.destCourseId, item.type, destId);

    onStep('Setting dates');
    return this.applyDates(task.destCourseId, item, destId, task.dates || {}, result).then(function () {
      // A module's items: their dates, found through the same mapping.
      return (task.children || []).reduce(function (p, child) {
        return p.then(function () {
          var childDest = sync.destIdFor(mapping, child.type, child.id);
          if (!childDest) {
            result.warnings.push('“' + (child.title || child.type) + '” was not found in the copy, so its dates were not set.');
            return null;
          }
          return self.applyDates(task.destCourseId, child, childDest, child.dates || {}, result).then(function () {
            if (task.mode === 'copy' && sync.TYPES[child.type].body) return self.settleChild(task, child, childDest, result);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      if (item.type === 'module') return self.publishModule(task, destId, result);
      if (!sync.TYPES[item.type].body) return null;
      onStep('Section note');
      return self.applyNoteAndPublish(task, destId, result);
    }).then(function () {
      result.ok = !result.error;
      return result;
    });
  };

  P.applyDates = function (courseId, item, destId, isoDates, result) {
    var sync = S();
    var type = sync.TYPES[item.type];
    var label = '“' + (item.title || type.label) + '”';
    var self = this;
    if (!sync.dateFields(item).length) return Promise.resolve();
    var read = type.datesVia === 'details'
      ? this.api.dateDetails(courseId, item.type, destId)
      : this.api.sectionItem(courseId, item.type, destId).then(function (o) {
        var out = {};
        sync.dateFields(item).forEach(function (f) { out[f] = o ? (o[f] || null) : null; });
        return out;
      });
    return read.then(null, function (err) {
      // Without knowing who the copy is assigned to, no dates are written:
      // a base date sent blind can assign it to everyone in that section.
      result.warnings.push(label + ': dates not set, because Canvas did not say how it is assigned there. ' +
        describe(err, 'Canvas refused') + ' Set them in that section.');
      return false;
    }).then(function (details) {
      if (details === false) return null;
      var w = sync.datesWrite(item, isoDates, details);
      if (w.skip) { result.warnings.push(label + ': dates left as copied, because ' + w.skip + '.'); return null; }
      if (w.unchanged) return null;
      var write = w.via === 'details'
        ? self.api.putDateDetails(courseId, item.type, destId, w.body)
        : self.api.updateSectionItem(courseId, item.type, destId, w.body);
      return write.then(function () {
        // Read back: what Canvas stored, not what was asked for.
        var back = w.via === 'details' ? self.api.dateDetails(courseId, item.type, destId) : self.api.sectionItem(courseId, item.type, destId);
        return back.then(function (stored) {
          var wrong = sync.dateFields(item).filter(function (f) {
            var want = isoDates[f] === undefined ? null : isoDates[f];
            return stored && stored[f] !== undefined && !sync.sameInstant(stored[f], want);
          });
          if (wrong.length) {
            result.warnings.push(label + ': Canvas did not keep the ' + wrong.map(function (f) { return (sync.DATE_LABELS[f] || f).toLowerCase(); }).join(', ') +
              ' date asked for. Check it in this section.');
          }
        }, function () {
          result.warnings.push(label + ': dates saved, but Canvas could not be asked to confirm them.');
        });
      }, function (err) {
        if (err && err.status === 403) {
          result.warnings.push(label + ': Canvas would not change its dates (' +
            'a closed grading period, or dates locked by a Blueprint). They are as copied.');
          return null;
        }
        result.warnings.push(label + ': dates not set. ' + describe(err, 'Canvas refused the dates'));
        return null;
      });
    });
  };

  /* Canvas's copy gives a module this section's published state, which is
   * "Same as this section". Otherwise the module is (un)published, and
   * Canvas (un)publishes its items with it, as the Modules page does. */
  P.publishModule = function (task, destId, result) {
    var self = this;
    if ((task.publish || 'match') === 'match') return Promise.resolve();
    var want = task.publish === 'published';
    return this.api.sectionItem(task.destCourseId, 'module', destId).then(function (o) {
      if (!o || o.published === undefined || !!o.published === want) return null;
      return self.api.updateSectionItem(task.destCourseId, 'module', destId, { module: { published: want } }).then(null, function (err) {
        result.warnings.push('The module is ' + (want ? 'not published' : 'still published') + ' in this section. ' + describe(err, 'Canvas refused'));
      });
    }, function (err) {
      result.warnings.push('Could not read the module back to set its publishing. ' + describe(err, 'Canvas refused'));
    });
  };

  /* A module's item after the module was copied: a note the source section
   * had on it came along and is removed (notes belong to one section), and
   * the copy is remembered so a later look can tell whether it changed. */
  P.settleChild = function (task, child, destId, result) {
    var self = this;
    var sync = S();
    return this.api.sectionItem(task.destCourseId, child.type, destId).then(function (o) {
      var html = (sync.toItem(child.type, o) || {}).html || '';
      var next = sync.withNote(html, (task.childNotes || {})[child.type + ':' + child.id] || '');
      var write = next === html ? Promise.resolve() : self.api.setItemHtml(task.destCourseId, child.type, destId, next).then(null, function (err) {
        result.warnings.push('“' + (child.title || '') + '”: the other section’s note could not be removed. ' + describe(err, 'Canvas refused'));
      });
      return write.then(function () { return self.remember(task.srcCourseId, child, task.destCourseId, destId, html); });
    }, function () { return null; });
  };

  P.applyNoteAndPublish = function (task, destId, result) {
    var self = this;
    var sync = S();
    var item = task.item;
    return this.api.sectionItem(task.destCourseId, item.type, destId).then(function (o) {
      var d = sync.toItem(item.type === 'announcement' ? 'discussion' : item.type, o) || {};
      var html = d.html || '';
      // Always rewritten after a copy: the source's own note (if it has one
      // for its section) came along with its instructions and belongs to it.
      var next = sync.withNote(html, task.note || '');
      var steps = Promise.resolve();
      if (next !== html) {
        steps = steps.then(function () {
          return self.api.setItemHtml(task.destCourseId, item.type, destId, next).then(null, function (err) {
            result.warnings.push('The section note was not saved. ' + describe(err, 'Canvas refused it'));
          });
        });
      }
      if (task.mode === 'copy') {
        steps = steps.then(function () {
          return self.remember(task.srcCourseId, item, task.destCourseId, destId, html);
        });
      }
      // "Same as this section" on a copy kept as that section's own leaves
      // its publishing alone too; only an explicit choice changes it.
      var keepState = task.mode === 'keep' && (task.publish || 'match') === 'match';
      if (item.type !== 'announcement' && !keepState) {
        var want = task.publish === 'published' ? true : (task.publish === 'unpublished' ? false : !!item.published);
        if (d.published !== undefined && !!d.published !== want) {
          steps = steps.then(function () {
            return self.api.setItemPublished(task.destCourseId, item.type, destId, want).then(null, function (err) {
              result.warnings.push((want ? 'Not published' : 'Still published') + ' in this section: ' +
                describe(err, 'Canvas refused') + (want ? '' : ' (Canvas keeps work that students have submitted published.)'));
            });
          });
        }
      }
      return steps;
    }, function (err) {
      result.warnings.push('Could not read the copy back to add the note and set publishing. ' + describe(err, 'Canvas refused'));
    });
  };

  /* ------------------------------------------- copies, in both directions */

  /* asset_id_mapping for the newest completed copy from srcCourseId into
   * destCourseId (null when there never was one). A mapping is remembered
   * for the page session under its migration id: a later copy is a new id. */
  P.mappingFor = function (destCourseId, srcCourseId, migrations) {
    var self = this;
    var list = migrations ? Promise.resolve(migrations) : this.api.contentMigrations(destCourseId);
    return list.then(function (migs) {
      var last = S().latestCopyFrom(migs, srcCourseId);
      if (!last) return null;
      var key = 'cgp.sections.map.' + destCourseId + '.' + last.id;
      try {
        var hit = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(key) : null;
        if (hit) return JSON.parse(hit);
      } catch (e) { /* no session storage */ }
      return self.api.assetIdMapping(destCourseId, last.id).then(function (m) {
        try { if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(key, JSON.stringify(m || {})); } catch (e) { /* full */ }
        return m || {};
      });
    });
  };

  /* For one item: the linked courses it was copied FROM (it is their copy)
   * and the ones it was copied TO (they hold copies of it).
   * {from: [{courseId, srcId}], to: [{courseId, destId}]}. Read only. */
  P.relations = function (courseId, item, siblings) {
    var self = this;
    var sync = S();
    var out = { from: [], to: [] };
    var mine = this.api.contentMigrations(courseId).catch(function () { return []; });
    return Promise.all(siblings.map(function (sib) {
      var from = mine.then(function (migs) { return self.mappingFor(courseId, sib, migs); }).then(function (m) {
        var srcId = sync.srcIdFor(m, item.type, item.id);
        if (srcId) out.from.push({ courseId: String(sib), srcId: String(srcId) });
      }).catch(function () { /* that section cannot be read: nothing to say about it */ });
      var to = self.mappingFor(sib, courseId).then(function (m) {
        var destId = sync.destIdFor(m, item.type, item.id);
        if (destId) out.to.push({ courseId: String(sib), destId: String(destId) });
      }).catch(function () { /* likewise */ });
      return Promise.all([from, to]);
    })).then(function () { return out; });
  };

  /* An original (in origCourse) and its copy (in copyCourse): which side
   * changed since the copy. {side, orig, copy} with both items read in full
   * (null side when either could not be read, or the copy was deleted). */
  P.compare = function (origCourse, origRef, copyCourse, copyId) {
    var self = this;
    var sync = S();
    var t = origRef.type === 'announcement' ? 'discussion' : origRef.type;
    return Promise.all([
      this.api.sectionItem(origCourse, origRef.type, origRef.id),
      this.api.sectionItem(copyCourse, origRef.type, copyId)
    ]).then(function (r) {
      if (!r[0] || !r[1] || r[1].workflow_state === 'deleted') return { side: null };
      var orig = sync.toItem(t, r[0]);
      var copy = sync.toItem(t, r[1]);
      orig.updatedAt = r[0].updated_at || null;
      copy.updatedAt = r[1].updated_at || null;
      orig.pointsPossible = r[0].points_possible;
      copy.pointsPossible = r[1].points_possible;
      return self.baseline(origCourse, origRef, copyCourse).then(function (base) {
        return {
          side: sync.changeSide(sync.fingerprint(orig.html), sync.fingerprint(copy.html), base),
          orig: orig, copy: copy, hasRecord: !!base
        };
      });
    }, function () { return { side: null }; });
  };

  /* ------------------------------------------- bringing a change back */

  var BACKUP_PREFIX = 'cgp.sections.backup.';

  /* What writing the copy's version onto the original would do, without
   * doing it: the original's new instructions (links turned into the
   * original course's), files only the copy has, links that cannot be
   * turned, whether the titles or points differ. */
  P.planBack = function (origCourse, origRef, copyCourse, copyId) {
    var self = this;
    var sync = S();
    return Promise.all([
      this.compare(origCourse, origRef, copyCourse, copyId),
      this.mappingFor(copyCourse, origCourse)
    ]).then(function (r) {
      var cmp = r[0];
      if (!cmp.side) throw new CGP.CanvasApiError('Could not read both versions from Canvas', {});
      var inv = sync.invertMapping(r[1] || {});
      var copyBody = sync.splitNote(cmp.copy.html || '').html;
      var tr = sync.translateLinks(copyBody, copyCourse, origCourse, inv, self.origin);
      return {
        origCourse: String(origCourse), copyCourse: String(copyCourse), type: origRef.type,
        origId: String(origRef.id), copyId: String(copyId),
        orig: cmp.orig, copy: cmp.copy, side: cmp.side, hasRecord: cmp.hasRecord,
        inv: inv, copyBody: copyBody, html: tr.html, missingFiles: tr.missingFiles, missingLinks: tr.missingLinks,
        origNote: sync.splitNote(cmp.orig.html || '').note,
        titleDiffers: String(cmp.orig.title || '') !== String(cmp.copy.title || ''),
        pointsDiffer: cmp.orig.pointsPossible !== undefined && cmp.copy.pointsPossible !== undefined &&
          Number(cmp.orig.pointsPossible) !== Number(cmp.copy.pointsPossible)
      };
    });
  };

  /* Write the copy's version onto the original. opts.title: the title too.
   * Files only the copy's course has are copied over first (Canvas's own
   * course copy of just those files), and their links pointed at the new
   * files. The original as it was is kept on this computer for undoBack.
   * Resolves {ok, error, warnings, url}; never rejects. */
  P.applyBack = function (plan, opts, onStep) {
    var self = this;
    var sync = S();
    opts = opts || {};
    onStep = onStep || function () {};
    var result = { ok: false, error: null, warnings: [], url: sync.itemHtmlPath(plan.origCourse, plan.type, plan.origId) };
    var html = plan.html;

    var files = Promise.resolve();
    if (plan.missingFiles.length) {
      onStep('Copying ' + plan.missingFiles.length + (plan.missingFiles.length === 1 ? ' file' : ' files'));
      files = this.api.startCourseCopy(plan.origCourse, {
        migration_type: 'course_copy_importer',
        select: { files: plan.missingFiles.slice() },
        settings: { source_course_id: plan.copyCourse }
      }).then(function (mig) {
        return self.waitFor(plan.origCourse, mig.id, self.maxWaitMs).then(function (m) {
          if (sync.migrationState(m) !== 'completed') throw new CGP.CanvasApiError('Canvas did not finish copying the files', {});
          return self.api.assetIdMapping(plan.origCourse, mig.id);
        });
      }).then(function (m) {
        var inv = Object.assign({}, plan.inv);
        inv.files = Object.assign({}, plan.inv.files || {});
        Object.keys((m && m.files) || {}).forEach(function (src) {
          var v = m.files[src];
          if (typeof v === 'string' || typeof v === 'number') inv.files[String(src)] = String(v);
        });
        var tr = sync.translateLinks(plan.copyBody, plan.copyCourse, plan.origCourse, inv, self.origin);
        html = tr.html;
        if (tr.missingFiles.length) result.warnings.push(tr.missingFiles.length + ' file link(s) still point to the other section.');
      }, function (err) {
        result.warnings.push('The files only that section has were not copied (' + describe(err, 'Canvas refused') +
          '), so their links still point there.');
      });
    }

    return files.then(function () {
      onStep('Saving a backup');
      var bk = {};
      bk[BACKUP_PREFIX + sync.trackKey(self.origin, plan.origCourse, plan.type, plan.origId, 'self')] =
        { title: plan.orig.title, html: plan.orig.html, at: self.now() };
      return self.store.set(bk);
    }).then(function () {
      onStep('Updating the original');
      var next = sync.withNote(html, plan.origNote || '');
      return self.api.setItemHtml(plan.origCourse, plan.type, plan.origId, next).then(function () {
        if (!opts.title || !plan.titleDiffers) return null;
        return self.api.updateSectionItem(plan.origCourse, plan.type, plan.origId, sync.titleBody(plan.type, plan.copy.title)).then(null, function (err) {
          result.warnings.push('The title was not changed. ' + describe(err, 'Canvas refused'));
        });
      }).then(function () {
        return self.api.sectionItem(plan.origCourse, plan.type, plan.origId);
      }).then(function (o) {
        var back = sync.toItem(plan.type === 'announcement' ? 'discussion' : plan.type, o) || {};
        if (sync.fingerprint(back.html || '') !== sync.fingerprint(next)) {
          result.warnings.push('Canvas saved the instructions with differences. Check them.');
        }
        // The copy now matches its original again: that is its new record.
        return self.remember(plan.origCourse, { type: plan.type, id: plan.origId }, plan.copyCourse, plan.copyId, plan.copy.html);
      }).then(function () {
        plan.missingLinks.forEach(function (l) {
          result.warnings.push('A link to ' + (l.type === 'pages' ? 'the page “' + l.ref + '”'
            : (l.type === 'link' ? '“' + l.ref + '”' : 'a ' + l.type.replace(/_/g, ' ').replace(/s$/, '') + ' (' + l.ref + ')')) +
            ' still points to the other section: it is not in this one.');
        });
        result.ok = true;
        return result;
      }, function (err) {
        result.error = describe(err, 'Canvas refused the update');
        return result;
      });
    }).then(null, function (err) {
      result.error = result.error || describe(err, 'Something went wrong');
      return result;
    });
  };

  /* Put the original back as it was before applyBack. */
  P.undoBack = function (plan) {
    var self = this;
    var sync = S();
    var k = BACKUP_PREFIX + sync.trackKey(self.origin, plan.origCourse, plan.type, plan.origId, 'self');
    return this.store.get(k).then(function (r) {
      var bk = r && r[k];
      if (!bk) throw new Error('No backup of the original was found on this computer.');
      return self.api.setItemHtml(plan.origCourse, plan.type, plan.origId, bk.html).then(function () {
        if (!plan.titleDiffers) return null;
        return self.api.updateSectionItem(plan.origCourse, plan.type, plan.origId, sync.titleBody(plan.type, bk.title));
      });
    });
  };

  /* --------------------------------------------------------- pending jobs */

  /* Jobs a closed tab left behind on this Canvas: finish them. Resolves the
   * results ([{job, result}]) of the ones it could finish or give up on. */
  P.resumePending = function () {
    var self = this;
    return this.store.get(null).then(function (all) {
      var jobs = Object.keys(all || {}).filter(function (k) { return k.indexOf(JOB_PREFIX) === 0; }).map(function (k) { return all[k]; });
      var now = self.now();
      var mine = jobs.filter(function (j) {
        return j && j.task && String(j.origin) === String(self.origin) && !(j.claimedAt && now - j.claimedAt < CLAIM_MS && j.claimedBy !== self.tabId);
      });
      var stale = jobs.filter(function (j) { return j && now - (j.startedAt || 0) > JOB_MAX_AGE_MS; });
      return Promise.all(stale.map(function (j) { return self.dropJob(j); })).then(function () {
        return mine.filter(function (j) { return stale.indexOf(j) < 0; }).reduce(function (p, job) {
          return p.then(function (done) {
            return self.saveJob(job).then(function () {
              var result = { ok: false, destId: null, url: null, warnings: [], pending: false, error: null };
              return self.continueJob(job, result, function () {}, { maxWaitMs: 1 }).then(function (r) {
                if (!r.pending) done.push({ job: job, result: r });
                return done;
              });
            });
          });
        }, Promise.resolve([]));
      });
    }, function () { return []; });
  };

  CGP.SectionCopier = SectionCopier;
  CGP.SectionCopier.JOB_PREFIX = JOB_PREFIX;
  CGP.SectionCopier.FP_PREFIX = FP_PREFIX;
  CGP.SectionCopier.BACKUP_PREFIX = BACKUP_PREFIX;
})();
