// One-page project description PDF for the DSH Hacks V1 submission.
const PDFDocument = require('pdfkit');
const fs = require('fs');

const out = '/home/user/lily_memo/lily-memo-project-description.pdf';
const doc = new PDFDocument({ size: 'A4', margins: { top: 36, bottom: 32, left: 44, right: 44 } });
doc.pipe(fs.createWriteStream(out));

const W = doc.page.width - 88; // content width
const ACCENT = '#6c5ce7';
const DARK = '#1a1a2e';
const GRAY = '#555566';

// ---- Header ----
doc.font('Helvetica-Bold').fontSize(26).fillColor(DARK).text('Lily Memo', { align: 'center' });
doc.moveDown(0.1);
doc.font('Helvetica').fontSize(11.5).fillColor(ACCENT)
  .text('AI-Powered Study Companion for STEM Education', { align: 'center' });
doc.moveDown(0.1);
doc.fontSize(8.5).fillColor(GRAY)
  .text('DSH Hacks V1  ·  AI × STEM Education  ·  github.com/sikunxchan/lily_memo', { align: 'center' });
doc.moveDown(0.4);
doc.moveTo(44, doc.y).lineTo(44 + W, doc.y).lineWidth(1).strokeColor(ACCENT).stroke();
doc.moveDown(0.5);

function sectionTitle(t) {
  doc.font('Helvetica-Bold').fontSize(11.5).fillColor(ACCENT).text(t);
  doc.moveDown(0.15);
}
function body(t, opts = {}) {
  doc.font('Helvetica').fontSize(8.8).fillColor(DARK).text(t, { lineGap: 1.2, ...opts });
}

// ---- The Problem ----
sectionTitle('The Problem');
body('STEM students spend most of their study time on passive input - reading textbooks, copying notes, watching lectures. Cognitive science consistently shows that active recall and spaced repetition are far more effective for retention, yet turning your own material into practice problems is slow and difficult, and off-the-shelf problem sets never match what you actually studied.');
doc.moveDown(0.5);

// ---- What It Does ----
sectionTitle('What It Does');
body('Lily Memo turns any study material - typed notes, PDFs, textbook photos, live lecture audio - into active learning. The built-in AI tutor Lily reads it and generates explanations, diagrams, quizzes, and full exam-style problem sets in real time.');
doc.moveDown(0.3);

const rows = [
  ['AI Tutor "Lily"', 'Chats over your notes, PDFs and images. Generates Mermaid diagrams, charts, geometry figures and 6 quiz types inserted directly into notes. Accuracy-first persona: corrects mistakes instead of agreeing.'],
  ['Floating "Sikun"', 'A draggable on-screen AI character for instant answers: note summaries, to-do extraction, PDF reading, translation, and writing annotations onto PDF pages.'],
  ['Practice Problem Sets', 'Multiple choice, written, fill-in, true/false, reading and chart questions - solved full-screen with scoring, explanations, attempt history and a "brutal" difficulty tier.'],
  ['PDF -> Markdown', 'Vision-based transcription of any PDF (scanned and handwritten included), saved as a note or .md file. Math is rendered as LaTeX.'],
  ['Live Lecture Summary', 'Record class audio -> auto-generates Cornell-style notes, key terms and 10 practice questions.'],
  ['Rich Notes', 'LaTeX math, code blocks, tables, handwriting blocks, sketches, wiki-style note links and a graph view of connections. Fully offline (IndexedDB).'],
  ['Gamified Tracking', 'Pomodoro sessions, level system (Lv 1-500), 35+ badges, trophy room, streaks, weekly schedule and tasks.'],
  ['Live Sync', 'Optional cross-device sync of everything via a shared key - conflict-safe with atomic compare-and-set.'],
];

const col1 = 118;
rows.forEach(([k, v]) => {
  const y0 = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.4).fillColor(DARK).text(k, 44, y0, { width: col1 - 8 });
  const y1 = doc.y;
  doc.font('Helvetica').fontSize(8.4).fillColor(GRAY).text(v, 44 + col1, y0, { width: W - col1, lineGap: 0.8 });
  doc.y = Math.max(y1, doc.y) + 3;
  doc.x = 44;
});
doc.moveDown(0.25);

// ---- How It Was Built ----
sectionTitle('How It Was Built');
body('Next.js 16 / React 19 / TypeScript - installable offline-capable PWA  ·  Gemini 2.5 Pro / Flash / Flash-Lite with 3-tier model fallback, extended thinking and vision input  ·  TipTap editor with custom nodes (Mermaid, Chart.js, geometry, Q&A cards, handwriting)  ·  Dexie (IndexedDB) local-first storage  ·  Upstash Redis live sync with a Lua compare-and-set script preventing concurrent-write data loss  ·  pdf.js, KaTeX, Mermaid, Chart.js, Web Audio API.');
doc.moveDown(0.2);
body('Voice features use MediaRecorder + WAV re-encoding instead of the Web Speech API, so they work inside installed PWAs on iOS where Web Speech silently fails.');
doc.moveDown(0.5);

// ---- Impact ----
sectionTitle('Impact');
body('Any student with a browser can use Lily Memo for free in English with zero setup (server-side API key). It targets STEM learners who have material but no time to turn it into practice: a lecture recording becomes structured notes in minutes, and a PDF chapter becomes a 20-question problem set with a single prompt.');
doc.moveDown(0.5);

// ---- Footer ----
doc.moveTo(44, doc.y).lineTo(44 + W, doc.y).lineWidth(0.5).strokeColor('#ccccdd').stroke();
doc.moveDown(0.3);
doc.font('Helvetica-Bold').fontSize(8.5).fillColor(DARK)
  .text('Turn passive study material into problems you can solve.', { align: 'center' });
doc.font('Helvetica').fontSize(8).fillColor(GRAY)
  .text('Built with Next.js  ·  Gemini 2.5  ·  Dexie  ·  Upstash Redis  ·  TipTap', { align: 'center' });

doc.end();
doc.on('end', () => console.log('done'));
