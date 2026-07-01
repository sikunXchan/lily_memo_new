// Catalogs for the chat toolbox.
//
// Three distinct concepts, deliberately kept separate:
//   - TONES        : how Lily *speaks* (a style directive appended per message)
//   - Skills       : how Lily *behaves* (a system prompt + reference materials);
//                    user-authored, stored in IndexedDB — see lib/skills.ts
//   - Shortcuts    : reusable one-tap prompts (e.g. 続きを書いて); user-authored,
//                    stored in localStorage — see lib/shortcuts.ts
//   - SLASH_COMMANDS: typed actions (/compact etc.) — handled in AIChat
//
// Only TONES and SLASH_COMMANDS are fixed built-ins, so they live here.

export interface ToneDef {
  id: string;
  label: string;
  directive: string;
}

// Tapping a tone toggles it ON; while ON, every message you send is answered
// in that style (until you tap it off again).
export const TONES: ToneDef[] = [
  { id: 'formal', label: '🎚️ フォーマル', directive: 'フォーマルで丁寧なトーンで答えて。' },
  { id: 'casual', label: '😊 カジュアル', directive: '親しみやすいカジュアルなトーンで答えて。' },
  { id: 'concise', label: '⚡ 簡潔に', directive: '要点だけを簡潔に短く答えて。' },
  { id: 'detailed', label: '📚 くわしく', directive: '背景や具体例も交えて、くわしく丁寧に説明して。' },
  { id: 'easy', label: '🍼 やさしく', directive: '専門用語を避けて、初心者にもわかるやさしい言葉で説明して。' },
  { id: 'socratic', label: '🧠 ソクラテス式', directive: '答えを直接教えず、ヒントや誘導質問でユーザー自身が気づけるよう導いてください（ソクラテス式対話）。間違いがあっても正解を言わず、「なぜそう思う？」「別の見方は？」など考えるきっかけの質問を返してください。' },
  { id: 'interviewer', label: '😈 面接官', directive: 'あなたは意地悪で容赦ない面接官です。ユーザーが説明や回答をするたびに「それって本当に理解してますか？」「もっと具体的に言ってください」「その根拠は？」「曖昧すぎます」など厳しく突っ込んでください。知識の穴や矛盾を積極的に突き、ごまかしや浅い理解は即座に見抜いて指摘してください。褒めるのは本当に正確・深い説明のときだけにして、それ以外は容赦なく圧をかけてください。ただし最終的には学習者のためになることを意識してください。' },
  { id: 'student', label: '🙋 生徒役', directive: 'あなたは何も知らない生徒です。ユーザーが先生役となって説明してくれます。あなたは授業を受ける無知な生徒として振る舞い、「それってどういう意味ですか？」「なんでそうなるんですか？」「もっとわかりやすく教えてください」「〇〇って何ですか？」のように素朴な疑問をどんどん投げかけてください。専門用語が出たら必ず「それ何ですか？」と聞き返してください。ユーザーが説明に詰まったり、説明が曖昧なときは「よくわかりませんでした…」と正直に伝えてください。ユーザーが本当に理解しているかを説明させることで確認するのが目的です。' },
];

export interface SlashCommandDef {
  id: string;
  cmd: string; // typed in the input, e.g. "/compact"
  description: string;
}

// Slash commands: typed in English by design — they trigger an action rather
// than changing how Lily talks. Always available (no curation needed).
export const SLASH_COMMANDS: SlashCommandDef[] = [
  { id: 'compact', cmd: '/compact', description: '会話の履歴をLilyに要約させて圧縮する（長い会話のコスト・読み返しやすさ対策）' },
  { id: 'clear', cmd: '/clear', description: '会話をリセットする' },
  { id: 'search', cmd: '/search', description: 'ネット検索をその場でONにして、正確に調べてから答えてもらう' },
  { id: 'quiz', cmd: '/quiz', description: 'ここまでの話題から練習問題(QA)を作ってもらう' },
  { id: 'hard', cmd: '/hard', description: '超難問・鬼問題を作成' },
  { id: 'review', cmd: '/review', description: 'これまでの理解を批判的にチェックしてもらう（添削）' },
  // Format modifiers — force Lily to output a specific QA block format.
  { id: 'qa', cmd: '/qa', description: '一問一答（Q&A）形式で問題を生成。例：/qa 江戸時代' },
  { id: 'fill', cmd: '/fill', description: '穴埋め問題形式で生成。例：/fill 光合成の仕組み' },
  { id: 'choice', cmd: '/choice', description: '選択問題（4択）形式で生成。例：/choice 三権分立' },
  { id: 'tf', cmd: '/tf', description: '○×問題形式で生成。例：/tf 細胞の構造' },
  { id: 'flash', cmd: '/flash', description: '単語カード形式で生成。例：/flash 英単語リスト' },
  { id: 'order', cmd: '/order', description: '並べ替え問題形式で生成。例：/order 歴史の流れ' },
];
