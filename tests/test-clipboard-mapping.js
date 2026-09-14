/* Clipboard parsing and the mapping from a pasted block onto Canvas ids. */
'use strict';

const { suite, assert: a } = require('./harness');
const CGP = globalThis.CGP;

suite('clipboard matrix parsing', (test) => {
  const parse = (text) => CGP.clipboardMatrix.parse(text);

  test('a single column of grades from Excel goes down the students', () => {
    const m = parse('10\n9\n8\n');
    a.eq(m.source, 'column');
    a.eq(m.rowCount, 3);
    a.eq(m.colCount, 1);
    a.deep(m.rows, [['10'], ['9'], ['8']]);
  });

  test('tab separated cells go across assignments', () => {
    const m = parse('10\t9\n8\t7');
    a.eq(m.source, 'tsv');
    a.eq(m.rowCount, 2);
    a.eq(m.colCount, 2);
    a.deep(m.rows, [['10', '9'], ['8', '7']]);
  });

  test('M, E, L and blanks survive a paste', () => {
    const m = parse('10\tM\nE\t\nL\t7');
    a.deep(m.rows, [['10', 'M'], ['E', ''], ['L', '7']]);
    a.eq(m.cellCount, 5, 'blank cells are not counted as writes');
  });

  test('ragged rows are padded so the grid mapping stays rectangular', () => {
    const m = parse('1\t2\t3\n4\n5\t6');
    a.eq(m.colCount, 3);
    a.deep(m.rows[1], ['4', '', '']);
  });

  test('CRLF and trailing newlines from Windows Excel are normalized away', () => {
    const m = parse('10\r\n9\r\n\r\n');
    a.eq(m.rowCount, 2);
    a.deep(m.rows, [['10'], ['9']]);
  });

  test('a hand typed space separated line is read as a column of grades', () => {
    const m = parse('5 5 M 4 E');
    a.eq(m.source, 'spaced-column');
    a.eq(m.rowCount, 5);
    a.deep(m.rows, [['5'], ['5'], ['M'], ['4'], ['E']]);
  });

  test('one value is one cell, and empty text yields nothing', () => {
    a.eq(parse('7').source, 'single');
    a.eq(parse('').cellCount, 0);
    a.eq(parse('   \n  ').cellCount, 0);
  });

  test('a locale-grouped thousands number is read as one value, not split across students', () => {
    const m = parse('1 000');
    a.eq(m.source, 'grouped-number');
    a.eq(m.rowCount, 1);
    a.deep(m.rows, [['1000']]);
  });

  test('a larger grouped number still collapses to one value', () => {
    const m = parse('12 345 678');
    a.deep(m.rows, [['12345678']]);
  });

  test('a hand typed list that merely looks numeric is NOT mistaken for grouping', () => {
    // Neither part after the first is exactly 3 digits, so this stays a list
    // of two separate grades, matching the pre-existing spaced-column feature.
    const m = parse('10 9');
    a.eq(m.source, 'spaced-column');
    a.deep(m.rows, [['10'], ['9']]);
  });
});

suite('mapping a pasted block onto Canvas ids', (test) => {
  // A pretend grid: rows 0-2 are students, columns 2-4 are assignments,
  // column 1 is the student name column and column 5 is Total.
  const students = { 0: '101', 1: '102', 2: '103' };
  const columns = {
    1: { type: 'student' },
    2: { type: 'assignment', assignmentId: '900' },
    3: { type: 'assignment', assignmentId: '901' },
    4: { type: 'assignment', assignmentId: '902' },
    5: { type: 'total' }
  };
  const accessors = {
    studentAt: (r) => students[r] || null,
    columnAt: (c) => columns[c] || null
  };

  test('a 3x2 block lands on the right students and assignments', () => {
    const m = CGP.clipboardMatrix.parse('10\t9\n8\t7\nM\tE');
    const out = CGP.gridMap.mapMatrixToTargets(m, { rowIndex: 0, colIndex: 2 }, accessors);
    a.eq(out.errors.length, 0);
    a.eq(out.targets.length, 6);
    a.deep(out.targets[0], { assignmentId: '900', userId: '101', token: '10', rowIndex: 0, colIndex: 2 });
    a.deep(out.targets[5], { assignmentId: '901', userId: '103', token: 'E', rowIndex: 2, colIndex: 3 });
  });

  test('blank cells are skipped instead of clearing grades', () => {
    const m = CGP.clipboardMatrix.parse('10\t\n\t7');
    const out = CGP.gridMap.mapMatrixToTargets(m, { rowIndex: 0, colIndex: 2 }, accessors);
    a.eq(out.targets.length, 2);
    a.eq(out.skipped, 2);
  });

  test('running off the end of the roster reports an error, not a wrong write', () => {
    const m = CGP.clipboardMatrix.parse('10\n9\n8\n7');
    const out = CGP.gridMap.mapMatrixToTargets(m, { rowIndex: 1, colIndex: 2 }, accessors);
    a.eq(out.targets.length, 2, 'only the resolvable rows produce targets');
    a.eq(out.errors.length, 2);
    a.eq(out.errors[0].code, 'unresolved-student');
  });

  test('pasting over the Total column is refused as not-an-assignment', () => {
    const m = CGP.clipboardMatrix.parse('10\t9\t8\t7');
    const out = CGP.gridMap.mapMatrixToTargets(m, { rowIndex: 0, colIndex: 2 }, accessors);
    const codes = out.errors.map((e) => e.code);
    a.eq(out.targets.length, 3);
    a.eq(codes.includes('not-an-assignment'), true);
  });

  test('pasting past the last column reports unresolved-column', () => {
    const m = CGP.clipboardMatrix.parse('10\t9');
    const out = CGP.gridMap.mapMatrixToTargets(m, { rowIndex: 0, colIndex: 5 }, accessors);
    a.eq(out.targets.length, 0);
    a.deep(out.errors.map((e) => e.code), ['not-an-assignment', 'unresolved-column']);
  });
});

suite('grid cell mapping', (test) => {
  test('column ids are read out of SlickGrid header element ids', () => {
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_1234_assignment_567'), 'assignment_567');
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_98_total_grade'), 'total_grade');
    a.eq(CGP.gridMap.parseSlickColumnId('not_a_slick_id'), null);
  });

  test('column ids are still found when the uid has no separating underscore', () => {
    // Real SlickGrid uid prefixes are not guaranteed to end in "_digits_";
    // the column id is always the trailing, recognizable part of the string.
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_2kqo7z6assignment_2331'), 'assignment_2331');
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_60student'), 'student');
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_60total_grade_override'), 'total_grade_override');
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_7custom_col_42'), 'custom_col_42');
    a.eq(CGP.gridMap.parseSlickColumnId('slickgrid_7assignment_group_9'), 'assignment_group_9');
  });

  test('column ids classify into assignment, group, total, student, custom', () => {
    a.deep(CGP.gridMap.classifyColumnId('assignment_567'), { type: 'assignment', assignmentId: '567' });
    a.deep(CGP.gridMap.classifyColumnId('assignment_group_42'), { type: 'group', groupId: '42' });
    a.eq(CGP.gridMap.classifyColumnId('total_grade').type, 'total');
    a.eq(CGP.gridMap.classifyColumnId('total_grade_override').type, 'total');
    a.eq(CGP.gridMap.classifyColumnId('student').type, 'student');
    a.eq(CGP.gridMap.classifyColumnId('student_name').type, 'student');
    a.eq(CGP.gridMap.classifyColumnId('custom_col_3').type, 'custom');
    a.eq(CGP.gridMap.classifyColumnId('').type, 'unknown');
  });

  test('a body cell reveals its column index through its class list', () => {
    a.eq(CGP.gridMap.columnIndexFromClassName('slick-cell l7 r7'), 7);
    a.eq(CGP.gridMap.columnIndexFromClassName('slick-cell l0 r0 active'), 0);
    a.eq(CGP.gridMap.columnIndexFromClassName('slick-cell'), null);
  });

  test('a row reveals its index through its absolute top offset', () => {
    a.eq(CGP.gridMap.rowIndexFromTop(0, 35), 0);
    a.eq(CGP.gridMap.rowIndexFromTop(105, 35), 3);
    a.eq(CGP.gridMap.rowIndexFromTop(106, 35), 3, 'sub-pixel rounding still lands on the row');
    a.eq(CGP.gridMap.rowIndexFromTop(105, 0), null, 'a zero row height must not divide');
    a.eq(CGP.gridMap.rowIndexFromTop('nope', 35), null);
  });

  test('cell keys are stable across the caches that share them', () => {
    a.eq(CGP.gridMap.cellKey('900', '101'), CGP.gridMap.cellKey(900, 101));
  });

  test('shift-click selects a rectangle of assignment cells only', () => {
    const students = { 0: '101', 1: '102' };
    const columns = {
      1: { type: 'student' },
      2: { type: 'assignment', assignmentId: '900' },
      3: { type: 'total' },
      4: { type: 'assignment', assignmentId: '901' }
    };
    const out = CGP.gridMap.rangeTargets(
      { rowIndex: 1, colIndex: 4 },
      { rowIndex: 0, colIndex: 1 },
      { studentAt: (r) => students[r] || null, columnAt: (c) => columns[c] || null }
    );
    a.eq(out.length, 4, '2 students x 2 assignment columns; name and Total excluded');
    a.deep(out.map((t) => t.assignmentId), ['900', '901', '900', '901']);
  });
});
