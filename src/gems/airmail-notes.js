/* Canvas Gradebook+ - Airmail: what the paper airplanes carry.
 *
 * Injected only on the day a plane flies (see airmail-state.js). Each note
 * has a stable id - the Shoebox stores ids, so never renumber one; add new
 * notes with new ids instead. Piles:
 *   day     - the everyday notes
 *   night   - planes that fly after 10pm
 *   friday  - Friday afternoons
 *   golden  - about one plane in twenty: a note from the teacher's own
 *             first year of teaching
 *   fall, winter, finale - the first weeks, the run-up to winter break and
 *             the last weeks of the year
 *   <subject> - one pile per subject in AirmailState.SUBJECTS (spanish,
 *             math, theology, ...), for a course whose name names it. The
 *             language piles are written in that language: a Spanish
 *             teacher's students would write in Spanish.
 * Nobody here is a real student: they are the notes every teacher gets,
 * sooner or later, from someone. */
(function () {
  'use strict';
  var CGP = (globalThis.CGP = globalThis.CGP || {});

  CGP.AIRMAIL_NOTES = [
    // ------------------------------------------------------------------ day
    { id: 'd01', pile: 'day', text: 'You probably don’t remember me, but you’re the reason I still read for fun.', from: 'the kid who sat by the window' },
    { id: 'd02', pile: 'day', text: 'I didn’t do the reading. But I wanted you to know I noticed how hard you try. Thanks.', from: 'back row, every year' },
    { id: 'd03', pile: 'day', text: 'You wrote “this is a real idea” next to one sentence of my essay. I still have it. I became a writer.', from: 'class of 2016' },
    { id: 'd04', pile: 'day', text: 'You learned my name in two days. Nobody else did that all year.', from: 'the new kid' },
    { id: 'd05', pile: 'day', text: 'I’m a teacher now. I steal your jokes. Sorry. (Not sorry.)', from: 'a former student, now a colleague' },
    { id: 'd06', pile: 'day', text: 'The day you stayed after to help me, I was going to drop out. I didn’t. I graduated in May.', from: 'someone who walked across the stage' },
    { id: 'd07', pile: 'day', text: 'You never once made me feel dumb for asking. I ask questions everywhere now.', from: 'the kid with all the questions' },
    { id: 'd08', pile: 'day', text: 'My mom put your comment on my report card on the fridge. It’s still there. It’s been six years.', from: 'third period' },
    { id: 'd09', pile: 'day', text: 'This is a thank-you note. I’m bad at these. You know what you did.', from: 'a person of few words' },
    { id: 'd10', pile: 'day', text: 'You gave me a C and told me I could do better, and you were right, and I hated it, and I did better.', from: 'a recovering procrastinator' },
    { id: 'd11', pile: 'day', text: 'Every grade you just entered is a tiny conversation with a kid who will grow up. Not bad for a weekday.', from: 'the gradebook, honestly' },
    { id: 'd12', pile: 'day', text: 'I folded this into a plane because you said our ideas should go places. Here’s one going places.', from: 'a literal thinker' },
    { id: 'd13', pile: 'day', text: 'You remembered I had a game that night and asked how it went. I lost. But you asked.', from: 'number 14' },
    { id: 'd14', pile: 'day', text: 'I didn’t understand anything until you drew it on the board with that terrible marker. Then I did.', from: 'a visual learner' },
    { id: 'd15', pile: 'day', text: 'I’m a nurse now. I explain things to scared people the way you explained things to me.', from: 'class of 2011' },
    { id: 'd16', pile: 'day', text: 'Your classroom was the only quiet place in my whole day. Thank you for keeping it that way.', from: 'someone who needed it' },
    { id: 'd17', pile: 'day', text: 'Fun fact: you are somebody’s “that one teacher.” Probably several somebodies.', from: 'a reliable source' },
    { id: 'd18', pile: 'day', text: 'You wrote “I believe you” when I said my dog ate it. My dog did eat it. Thank you.', from: 'the owner of a very bad dog' },
    { id: 'd19', pile: 'day', text: 'I still hear you say “show your work” every time I do my taxes.', from: 'an accountant, somehow' },
    { id: 'd20', pile: 'day', text: 'You treated me like I was going to be someone. So I got started on that.', from: 'someone, in progress' },
    { id: 'd21', pile: 'day', text: 'Thank you for the extra day on that project. You didn’t know what was going on at home. It helped more than you know.', from: 'a quiet one' },
    { id: 'd22', pile: 'day', text: 'I was scared of your class. Then it was my favorite class. Both of those were your fault.', from: 'a convert' },
    { id: 'd23', pile: 'day', text: 'This plane is carrying approximately one (1) metric ton of gratitude. Please lift with your knees.', from: 'the engineering club' },
    { id: 'd24', pile: 'day', text: 'You laughed at my joke in class. In front of everyone. It was not that funny. I will never forget it.', from: 'the class clown, retired' },
    { id: 'd25', pile: 'day', text: 'My kid has a teacher like you this year. I wanted you to know what that looks like from the other side: it looks like everything.', from: 'a former student, now a parent' },
    { id: 'd26', pile: 'day', text: 'You read our names off the roster like they mattered. They did. Thanks for knowing that.', from: 'the one everyone mispronounces' },
    { id: 'd27', pile: 'day', text: 'Remember the lesson that totally flopped? I learned the most that day. Mostly from watching you not give up.', from: 'a witness' },
    { id: 'd28', pile: 'day', text: 'Hi. I found this in an old notebook. I wrote it in 9th grade and never gave it to you. It says: “you’re the best.” Still true.', from: 'a very late delivery' },
    { id: 'd29', pile: 'day', text: 'I got into the program. In the essay I wrote about your class. Nobody told you that, so I’m telling you.', from: 'an admitted student' },
    { id: 'd30', pile: 'day', text: 'Thank you for the granola bar that one morning. I hadn’t eaten. You didn’t make it a big deal. That was the big deal.', from: 'second period' },
    { id: 'd31', pile: 'day', text: 'You said “not yet” instead of “no.” I’ve been saying “not yet” to myself for ten years now.', from: 'a not-yet that became a yes' },
    { id: 'd32', pile: 'day', text: 'You can’t see it from where you’re sitting, but it’s working. All of it. Keep going.', from: 'the future' },

    // ---------------------------------------------------------------- night
    { id: 'n01', pile: 'night', text: 'It’s late. The essays will still be here tomorrow. You should be too — rested.', from: 'the moon, on behalf of your students' },
    { id: 'n02', pile: 'night', text: 'Fun fact: no student in history has ever said “I wish my teacher had slept less.”', from: 'a well-researched owl' },
    { id: 'n03', pile: 'night', text: 'This plane is made of the homework you’re allowed to finish in the morning.', from: 'your future self, who is grateful' },
    { id: 'n04', pile: 'night', text: 'Everyone in your class is asleep right now. Every single one. Probably dreaming about lunch. Join them.', from: 'the night shift' },
    { id: 'n05', pile: 'night', text: 'Grading by lamplight is very poetic. So is a full night’s sleep. Ask any poet.', from: 'a poet (asleep)' },
    { id: 'n06', pile: 'night', text: 'Tonight’s grades are perfect. Close the laptop before you find out otherwise.', from: 'a friend in the dark' },
    { id: 'n07', pile: 'night', text: 'Somewhere a student is lying awake worried about this assignment. You can both stop now. It’s fine.', from: 'the 11 o’clock news' },
    { id: 'n08', pile: 'night', text: 'You’ve been a good teacher today. Now be a good sleeper. You’ll be great at it.', from: 'your pillow, who misses you' },

    // --------------------------------------------------------------- friday
    { id: 'f01', pile: 'friday', text: 'It’s Friday. Whatever’s left in this gradebook can learn to wait.', from: 'the weekend, idling outside' },
    { id: 'f02', pile: 'friday', text: 'You made it through another week of teaching humans. Humans! Unbelievable work.', from: 'an impressed observer' },
    { id: 'f03', pile: 'friday', text: 'Official decree: the remainder of this afternoon is for coffee, a walk, or doing absolutely nothing.', from: 'the Department of Fridays' },
    { id: 'f04', pile: 'friday', text: 'Count today’s wins: one kid got it. One kid laughed. One kid came back. That’s a great week.', from: 'the tally keeper' },
    { id: 'f05', pile: 'friday', text: 'This airplane is cleared for weekend departure. Please return your tray tables to the upright position and leave the grading in the overhead bin.', from: 'your captain' },
    { id: 'f06', pile: 'friday', text: 'Somebody in your class is telling their family about something you said this week. Right now. Over dinner.', from: 'a dinner table near you' },

    // --------------------------------------------------------------- golden
    { id: 'g01', pile: 'golden', text: 'Hi. It’s me — you, from your first year. I was so scared I’d be bad at this. Looking at you now, I can stop worrying.', from: 'you, the first September' },
    { id: 'g02', pile: 'golden', text: 'Remember when you cried in the car after that first parent night? Look how far you’ve come. I’m proud of us.', from: 'you, year one' },
    { id: 'g03', pile: 'golden', text: 'You kept the shoebox. I knew you would. Every note in it was earned. So is this one.', from: 'you, before you had a shoebox' },
    { id: 'g04', pile: 'golden', text: 'I didn’t know if I’d last five years. You’re still here. Still caring. That’s the whole job, and you’re doing it.', from: 'you, on the first day of school' },
    { id: 'g05', pile: 'golden', text: 'I wanted to change the world. Turns out you change it about thirty kids at a time. Better plan than mine.', from: 'you, back when you had a five-year plan' },
    { id: 'g06', pile: 'golden', text: 'You finally figured out how to work the copier. I never thought I’d see the day. Nothing is impossible.', from: 'you, jammed in Room 114' },
    // -------------------------------------------------------- fall
    { id: 's101', pile: 'fall', text: 'New year, new names, new faces. You’re about to become a few dozen people’s favorite memory.', from: 'September, with sharpened pencils' },
    { id: 's102', pile: 'fall', text: 'The first weeks are the hardest. They’re also when someone quietly decides your room is their safe place.', from: 'someone deciding right now' },
    { id: 's103', pile: 'fall', text: 'Fresh gradebook. Fresh start. For them and for you.', from: 'a clean column' },

    // ------------------------------------------------------ winter
    { id: 's201', pile: 'winter', text: 'Almost break. Almost. You can do it. There is cocoa at the end of this tunnel.', from: 'the last week before break' },
    { id: 's202', pile: 'winter', text: 'This plane flew through a snowstorm to tell you: rest well over break. You earned every minute.', from: 'a very cold pilot' },
    { id: 's203', pile: 'winter', text: 'The best gift you give every year doesn’t fit under a tree. They’ll be unwrapping it for decades.', from: 'the holiday committee' },

    // ------------------------------------------------------ finale
    { id: 's301', pile: 'finale', text: 'Last weeks. Somebody is going to say “I’ll miss this class” and mean it.', from: 'the last row on the last day' },
    { id: 's302', pile: 'finale', text: 'Before you close this gradebook for the summer: you did it. Another whole year of making people better.', from: 'the final bell' },
    { id: 's303', pile: 'finale', text: 'They’ll forget the test. They will not forget how you made them feel in this room.', from: 'everyone leaving in June' },

    // ----------------------------------------------------- spanish
    { id: 'spa01', pile: 'spanish', text: 'Profe: gracias por no rendirse conmigo. Ahora sueño en español (a veces con errores de subjuntivo).', from: 'su estudiante de la tercera fila' },
    { id: 'spa02', pile: 'spanish', text: 'Usted me enseñó que equivocarse es parte de aprender. Me equivoqué muchísimo. ¡Y aprendí muchísimo!', from: 'alguien que confundía «ser» y «estar»' },
    { id: 'spa03', pile: 'spanish', text: 'Este verano viajé a México y pedí tacos sin señalar el menú. Casi lloro de orgullo. ¡Gracias!', from: 'un exalumno con hambre' },
    { id: 'spa04', pile: 'spanish', text: 'Ojalá que sepa cuánto le apreciamos. (¿Ve? Subjuntivo. De nada.)', from: 'toda la clase de español' },
    { id: 'spa05', pile: 'spanish', text: 'Hoy usé el pretérito y el imperfecto en la misma frase. Correctamente. Pensé en usted.', from: 'un milagro gramatical' },
    { id: 'spa06', pile: 'spanish', text: 'Ahora trabajo de intérprete en un hospital. Todo empezó en su clase, con una canción tonta de los verbos.', from: 'promoción de 2014' },

    // ------------------------------------------------------ french
    { id: 'fre01', pile: 'french', text: 'Merci pour votre patience infinie avec mon accent. Il est toujours terrible, mais je l’adore.', from: 'votre élève du fond de la classe' },
    { id: 'fre02', pile: 'french', text: 'Je suis allé à Paris et j’ai commandé un croissant sans paniquer. C’est grâce à vous.', from: 'un ancien élève, très fier' },
    { id: 'fre03', pile: 'french', text: 'Vous m’avez appris que les erreurs sont des pas vers la réussite. J’ai fait beaucoup de pas.', from: 'quelqu’un qui confond encore « tu » et « vous »' },
    { id: 'fre04', pile: 'french', text: 'Le subjonctif me fait toujours peur. Mais vous m’avez donné le courage de l’affronter.', from: 'un élève courageux' },

    // ------------------------------------------------------ german
    { id: 'ger01', pile: 'german', text: 'Danke, dass Sie nie aufgegeben haben — nicht einmal bei meinen Artikeln. Der, die, das … ich arbeite noch daran.', from: 'Ihre Schülerin aus der dritten Reihe' },
    { id: 'ger02', pile: 'german', text: 'Ich habe in Berlin nach dem Weg gefragt und die Antwort verstanden! Unglaublich. Danke!', from: 'ein ehemaliger Schüler' },
    { id: 'ger03', pile: 'german', text: 'Sie haben mir gezeigt, dass Fehler zum Lernen gehören. Ich habe also sehr, sehr viel gelernt.', from: 'jemand mit vielen Fehlern' },
    { id: 'ger04', pile: 'german', text: 'Dieses Wort gibt es nicht, aber es sollte: Lieblingslehrerdankbarkeit. Das fühle ich gerade.', from: 'ein Fan von langen Wörtern' },

    // ------------------------------------------------------- latin
    { id: 'lat01', pile: 'latin', text: 'Gratias tibi ago, magister optime. Linguam mortuam vivam fecisti.', from: 'discipulus tuus, olim' },
    { id: 'lat02', pile: 'latin', text: 'Veni, vidi, didici. (I came, I saw, I learned.)', from: 'a former student, borrowing from Caesar' },
    { id: 'lat03', pile: 'latin', text: 'Docendo discimus. You taught me that — and now I teach, too.', from: 'a colleague, once your student' },
    { id: 'lat04', pile: 'latin', text: 'Non scholae sed vitae discimus. Thank you for the vitae part.', from: 'a student of life (and declensions)' },

    // ----------------------------------------------------- chinese
    { id: 'chi01', pile: 'chinese', text: '老师，谢谢您的耐心。我的声调还不完美，但我会继续努力！', from: '您的学生' },
    { id: 'chi02', pile: 'chinese', text: '我去了北京，自己点了菜。服务员都听懂了！谢谢老师！', from: '一个很骄傲的老学生' },
    { id: 'chi03', pile: 'chinese', text: '一日为师，终身为父母。谢谢您，老师。', from: '永远感谢您的学生' },

    // -------------------------------------------------------- math
    { id: 'mat01', pile: 'math', text: 'You said “show your work.” So here it is: me + your class = a math major. QED.', from: 'a former student, now proving things' },
    { id: 'mat02', pile: 'math', text: 'I used to think I wasn’t a math person. You proved me wrong by counterexample.', from: 'the counterexample' },
    { id: 'mat03', pile: 'math', text: 'Thank you for being the constant in a semester full of variables.', from: 'x, still solving for y' },
    { id: 'mat04', pile: 'math', text: 'My confidence in math had a derivative of zero until your class. Then it was strictly increasing.', from: 'a well-behaved function' },
    { id: 'mat05', pile: 'math', text: 'Your patience is irrational: it goes on forever and never repeats a complaint.', from: 'π-ously yours' },
    { id: 'mat06', pile: 'math', text: 'Somebody in your class just understood fractions for the first time. Somewhere, a pizza is being shared fairly because of you.', from: 'a very fair pizza' },

    // ----------------------------------------------------- biology
    { id: 'bio01', pile: 'biology', text: 'You made me look at a pond and see a whole world. I’m a marine biologist now.', from: 'someone who still loves ponds' },
    { id: 'bio02', pile: 'biology', text: 'Mitochondria are the powerhouse of the cell. You are the powerhouse of the school.', from: 'every biology student, ever' },
    { id: 'bio03', pile: 'biology', text: 'Thank you for not being mad when we named the class frog after you. It was a compliment.', from: 'the frog committee' },
    { id: 'bio04', pile: 'biology', text: 'You taught us that everything alive is connected. That includes us and you.', from: 'an ecosystem of grateful students' },

    // --------------------------------------------------- chemistry
    { id: 'che01', pile: 'chemistry', text: 'You and your classes have great chemistry. That’s not a pun. Okay, it’s a pun.', from: 'a highly reactive student' },
    { id: 'che02', pile: 'chemistry', text: 'I came into your class inert. You were the catalyst.', from: 'a former noble gas' },
    { id: 'che03', pile: 'chemistry', text: 'Thank you for letting us watch things explode safely. Still the best day of high school.', from: 'goggles, worn proudly' },
    { id: 'che04', pile: 'chemistry', text: 'I’m a pharmacist now. Every label I read, I hear you say “check your units.”', from: 'mL, not L' },

    // ----------------------------------------------------- physics
    { id: 'phy01', pile: 'physics', text: 'An object at rest stays at rest unless acted on by an outside force. You were my outside force.', from: 'a formerly stationary object' },
    { id: 'phy02', pile: 'physics', text: 'You taught me that energy is never lost, only transferred. Yours lives in all of us now.', from: 'conservation, in action' },
    { id: 'phy03', pile: 'physics', text: 'Thank you for dropping things off the roof in the name of science. And for the egg drop.', from: 'an egg that survived' },
    { id: 'phy04', pile: 'physics', text: 'This plane’s lift was calculated using your notes. Please excuse the drag.', from: 'your aerodynamics unit' },

    // ----------------------------------------------------- science
    { id: 'sci01', pile: 'science', text: 'You answered “I don’t know — let’s find out.” That’s the day I fell in love with science.', from: 'a scientist, because of that day' },
    { id: 'sci02', pile: 'science', text: 'I still ask “what’s the evidence?” at every family dinner. My family blames you. I thank you.', from: 'a skeptic, in the good way' },
    { id: 'sci03', pile: 'science', text: 'Hypothesis: you are an excellent teacher. Data: every one of us. Conclusion: strongly supported.', from: 'the lab report you never had to grade' },

    // ----------------------------------------------------- history
    { id: 'his01', pile: 'history', text: 'You made the past feel full of real people. Now I see them everywhere.', from: 'a future historian' },
    { id: 'his02', pile: 'history', text: 'History will remember you kindly. I’ve seen the primary sources. (They’re us.)', from: 'a reliable primary source' },
    { id: 'his03', pile: 'history', text: 'You taught me to ask “who’s telling this story, and why?” I ask it every single day.', from: 'a citizen, paying attention' },
    { id: 'his04', pile: 'history', text: 'Those who don’t learn from history are doomed to repeat it. I learned it from you, so I only repeat your jokes.', from: 'your best (worst) audience' },
    { id: 'his05', pile: 'history', text: 'I became a lawyer because of the mock trial in your class. Objection: you deserve more thanks than this.', from: 'counsel for the defense' },

    // ----------------------------------------------------- english
    { id: 'eng01', pile: 'english', text: 'You wrote “this sentence sings” in the margin. I’ve been trying to write sentences that sing ever since.', from: 'a writer, still revising' },
    { id: 'eng02', pile: 'english', text: 'Thank you for the books. Especially the one I pretended to hate and secretly reread every year.', from: 'you know which one' },
    { id: 'eng03', pile: 'english', text: 'I used a semicolon correctly in a work email today; my boss was impressed; I thought of you.', from: 'a punctuation enthusiast' },
    { id: 'eng04', pile: 'english', text: 'In the novel of my life, you are a pivotal character. Round, not flat. Dynamic, not static.', from: 'the protagonist' },
    { id: 'eng05', pile: 'english', text: 'You taught us that every story matters. So I’m telling you: yours does too.', from: 'the narrator' },

    // ---------------------------------------------------- theology
    { id: 'the01', pile: 'theology', text: 'You never just taught us about faith. You showed us what it looks like on an ordinary Tuesday.', from: 'a student who was watching' },
    { id: 'the02', pile: 'theology', text: '“Our hearts are restless until they rest in You.” You helped my restless heart find its way.', from: 'a restless heart, a little less restless' },
    { id: 'the03', pile: 'theology', text: 'You answered my hardest questions with honesty instead of easy answers. That’s why I still ask them.', from: 'the one with the hard questions' },
    { id: 'the04', pile: 'theology', text: 'Thank you for praying for us. We noticed. Some of us pray for you now.', from: 'your students, at night' },
    { id: 'the05', pile: 'theology', text: 'You taught me that love is a verb. I’ve been conjugating it ever since.', from: 'a work in progress' },
    { id: 'the06', pile: 'theology', text: 'Tolle lege — you told us to take up and read. I did. I still do.', from: 'a reader, because you asked' },

    // ------------------------------------------------------- music
    { id: 'mus01', pile: 'music', text: 'You heard music in us before we could play a single note in tune.', from: 'the brass section' },
    { id: 'mus02', pile: 'music', text: 'Thank you for every rehearsal you stayed late for. Fermata on this thank-you: hold as long as you like.', from: 'second chair, forever grateful' },
    { id: 'mus03', pile: 'music', text: 'I play in a community band now. Still second clarinet. Every concert, I think of you.', from: 'a lifelong musician' },
    { id: 'mus04', pile: 'music', text: 'Life is mostly rests and accidentals. You taught us to keep playing anyway.', from: 'the percussion kid' },
    { id: 'mus05', pile: 'music', text: 'I still count four beats in my head before I say anything important.', from: 'one, two, three, four' },

    // --------------------------------------------------------- art
    { id: 'art01', pile: 'art', text: 'You looked at my messy drawing and said “tell me about this.” Nobody had ever asked before.', from: 'an artist, since that day' },
    { id: 'art02', pile: 'art', text: 'I’m a designer now. Every color choice I make is still judged by your voice in my head.', from: 'a designer, still hearing you' },
    { id: 'art03', pile: 'art', text: 'Thank you for the paint on your shoes and the time on your hands.', from: 'the ceramics table' },
    { id: 'art04', pile: 'art', text: 'You said there are no mistakes, only discoveries. My whole sketchbook is discoveries.', from: 'someone who stopped erasing' },

    // ------------------------------------------------------- drama
    { id: 'dra01', pile: 'drama', text: 'You gave me the courage to stand on a stage. Now I’m brave in rooms with no stage at all.', from: 'a former understudy' },
    { id: 'dra02', pile: 'drama', text: 'Break a leg today. Figuratively. Please do not literally. We need you.', from: 'the stage crew' },
    { id: 'dra03', pile: 'drama', text: 'All the world’s a stage, and you’re the director who made us believe in our lines.', from: 'the whole cast, taking a bow' },

    // ---------------------------------------------------------- cs
    { id: 'cs01', pile: 'cs', text: 'You taught me bugs aren’t failures, they’re puzzles. I debug for a living now.', from: 'a professional puzzle solver' },
    { id: 'cs02', pile: 'cs', text: 'while (true) { thank(you); }', from: 'an infinite loop, on purpose' },
    { id: 'cs03', pile: 'cs', text: 'Hello, World! (It was my first program. You were there.)', from: 'a programmer, since line one' },
    { id: 'cs04', pile: 'cs', text: 'My code comments at work are excellent. My coworkers ask where I learned that. I tell them.', from: '// thanks for everything' },

    // ---------------------------------------------------------- pe
    { id: 'pe01', pile: 'pe', text: 'You cheered when I came in last in the mile. I run marathons now. Still slow. Still running.', from: 'a happy back-of-the-pack runner' },
    { id: 'pe02', pile: 'pe', text: 'Thank you for picking teams so that nobody was ever picked last.', from: 'someone who used to be' },
    { id: 'pe03', pile: 'pe', text: 'You taught us that strong means showing up. I’m still showing up.', from: 'a person who stretches now' },

    // --------------------------------------------------- economics
    { id: 'eco01', pile: 'economics', text: 'Opportunity cost of taking your class: zero. Return on investment: enormous.', from: 'a rational actor' },
    { id: 'eco02', pile: 'economics', text: 'You taught me supply and demand. The demand for teachers like you far exceeds the supply.', from: 'the invisible hand, waving' },
    { id: 'eco03', pile: 'economics', text: 'I made my first real budget because of you. It has a line item for gratitude.', from: 'a responsible adult (mostly)' },

    // -------------------------------------------------- psychology
    { id: 'psy01', pile: 'psychology', text: 'You taught us about growth mindset, and then you actually believed in mine.', from: 'a growing mind' },
    { id: 'psy02', pile: 'psychology', text: 'Observation report: subject took your class and is thriving. Results replicated in every classmate.', from: 'the study participants' },
    { id: 'psy03', pile: 'psychology', text: 'Thanks for teaching me that everyone has a story. I listen differently now.', from: 'a better listener' }
  ];
})();
