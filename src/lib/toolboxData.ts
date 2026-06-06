// Shared catalogs for the chat "toolbox": tones (speaking style directives),
// skills (prompt templates for specific study tasks), and shortcut commands
// (slash commands typed in the chat input). Both AIChat and ToolboxModal read
// from these so there is a single source of truth for ids/labels.

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

export interface SkillDef {
  id: string;
  label: string;
  description: string;
  // Prompt template inserted into the input box (user can edit before sending).
  prompt: string;
}

// Official sample skills: structured prompt templates for specific study
// tasks. Unlike tones (how to speak), skills define *what shape* the answer
// should take — the steps/format Lily follows when working through a task.
export const SKILLS: SkillDef[] = [
  {
    id: 'past-exam',
    label: '📝 過去問解説',
    description: '〈問題文の要点 → 正解の根拠 → 誤答が誤りである理由 → 関連用語〉の型で、資格試験の過去問を解説してもらう',
    prompt: 'この問題を、次の型で解説して：\n1. 問題文の要点（何を問われているか）\n2. 正解とその根拠（なぜそれが正しいのか、根拠となる知識・条文・原理を示す）\n3. 他の選択肢が誤りである理由（一つずつ、なぜ違うのかを具体的に）\n4. 関連用語・周辺知識の補足\n曖昧な解説で済ませず、根拠を明確にして。\n\n問題：',
  },
  {
    id: 'study-plan',
    label: '🗓️ 学習計画',
    description: '試験日・現在の理解度・使える時間から逆算して、無理のない学習計画を立ててもらう',
    prompt: '試験日と、今の自分の状況から逆算して学習計画を立てて。以下を教えるので、計画を組んでほしい：\n- 試験名・試験日：\n- 今の理解度（得意・苦手分野）：\n- 1日に使える勉強時間：\n計画は週単位で、何をどの順番でやるべきかと、その理由をセットで示して。詰め込みすぎず、復習の時間も組み込んで。',
  },
  {
    id: 'weak-point',
    label: '🎯 弱点分析',
    description: 'ここまでの会話やメモを振り返って、理解が浅い・誤解している箇所を批判的に洗い出してもらう',
    prompt: 'ここまでの会話や参照したメモを振り返って、私の理解が浅い・間違っている・曖昧なままになっている箇所を遠慮なく指摘して。「だいたい合ってる」のような甘い評価はせず、具体的にどこがどう不十分なのかと、何を復習すべきかを挙げて。',
  },
];

export interface ShortcutDef {
  id: string;
  cmd: string; // typed in the input, e.g. "/compact"
  description: string;
}

// Slash commands: typed in English by design (per user direction) — they
// trigger an action rather than changing how Lily talks.
export const SHORTCUTS: ShortcutDef[] = [
  { id: 'compact', cmd: '/compact', description: '会話の履歴をLilyに要約させて圧縮する（長い会話のコスト・読み返しやすさ対策）' },
  { id: 'clear', cmd: '/clear', description: '会話をリセットする' },
  { id: 'search', cmd: '/search', description: 'ネット検索をその場でONにして、正確に調べてから答えてもらう' },
  { id: 'quiz', cmd: '/quiz', description: 'ここまでの話題から練習問題(QA)を作ってもらう' },
  { id: 'review', cmd: '/review', description: 'これまでの理解を批判的にチェックしてもらう（添削）' },
];
