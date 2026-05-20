export interface ChatAttachment {
  mimeType: string;
  data: string; // base64 without the data: prefix; empty string when fileUri or extractedText is set
  fileUri?: string;      // Gemini File API URI — used for large images
  extractedText?: string; // pre-extracted text content for PDFs
}

// Upload a file to the Gemini File API and return its URI.
// Files expire after 48 h on the free tier, which is fine for chat use.
export async function uploadToFileApi(
  base64Data: string,
  mimeType: string,
  displayName: string,
  apiKey: string,
): Promise<string> {
  // Decode base64 → binary
  const binaryStr = atob(base64Data);
  const binary = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) binary[i] = binaryStr.charCodeAt(i);

  // Build multipart/related body (metadata + file bytes)
  const boundary = `gem_${Date.now()}`;
  const enc = new TextEncoder();
  const head = enc.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ file: { display_name: displayName } }) +
    `\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const tail = enc.encode(`\r\n--${boundary}--`);

  const body = new Uint8Array(head.length + binary.length + tail.length);
  body.set(head, 0);
  body.set(binary, head.length);
  body.set(tail, head.length + binary.length);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/related; boundary=${boundary}`,
        'X-Goog-Upload-Protocol': 'multipart',
      },
      body,
    },
  );

  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message || 'File API upload failed');
  }

  const data = await res.json() as { file?: { uri?: string } };
  const uri = data.file?.uri;
  if (!uri) throw new Error('File API returned no URI');
  return uri;
}

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  attachments?: ChatAttachment[];
}

// Free-tier quotas differ per model and Google changes them over time, so we
// try models in order and fall back to the next one on transient errors.
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
];

// Status codes that are transient — retry with the next model.
const RETRY_STATUSES = new Set([429, 500, 503, 529]);

export interface ChatOptions {
  webSearch?: boolean;
  models?: string[];
}

export interface SikunLilyProgress {
  stage: 1 | 2;
  label: string;
}

export async function callGeminiChat(
  history: ChatTurn[],
  systemPrompt: string,
  apiKey: string,
  options: ChatOptions = {}
): Promise<string> {
  const baseBody = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: history.map(t => ({
      role: t.role,
      parts: [
        { text: t.text },
        ...(t.attachments?.flatMap(a =>
          a.extractedText
            ? [{ text: `[添付PDF の内容]\n${a.extractedText}` }]
            : a.fileUri
              ? [{ file_data: { mime_type: a.mimeType, file_uri: a.fileUri } }]
              : [{ inline_data: { mime_type: a.mimeType, data: a.data } }]
        ) ?? []),
      ],
    })),
    generationConfig: {
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 8192,
    },
  };

  let lastError = 'AI request failed';
  const modelList = options.models ?? GEMINI_MODELS;
  // Per-model retry attempts for transient errors (demand spikes, quota).
  const MAX_ATTEMPTS = 3;

  for (let i = 0; i < modelList.length; i++) {
    const model = modelList[i];
    const useSearch = options.webSearch && !model.includes('1.5');
    const body = JSON.stringify(
      useSearch ? { ...baseBody, tools: [{ google_search: {} }] } : baseBody
    );

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      // Exponential backoff: 0s, 2s, 4s within a model; 1s between models.
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
      else if (i > 0) await new Promise(r => setTimeout(r, 1000));

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

      if (response.ok) {
        const data = await response.json();
        const parts = data.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) {
          const text = parts
            .map((p: { text?: string }) => p.text || '')
            .join('')
            .trim();
          if (text) return text;
        }
        lastError = data.candidates?.[0]?.finishReason
          ? `応答を生成できなかったよ (${data.candidates[0].finishReason})`
          : '空の応答が返ってきたよ';
        break; // non-retryable empty response → next model
      }

      const error = await response.json().catch(() => null);
      lastError = error?.error?.message || lastError;

      // Hard errors (bad key, bad request, model not found) → stop immediately.
      if (!RETRY_STATUSES.has(response.status)) {
        if (response.status === 404) break; // model gone → next model
        throw new Error(lastError);
      }
      // Transient error: retry this model (loop continues).
    }
  }

  throw new Error(
    `ごめんね、うまく答えられなかった…💦 少し時間をおくか、メモ/ファイルを変えて試してみてね。\n${lastError}`
  );
}

export const LILY_CHAT_SYSTEM_PROMPT = `
あなたは「Lily」という名前の、Lily Memoアプリの専属AIアシスタントです。ピンクのパーカーを着た可愛い柴犬（犬）のキャラクターです。キツネではなく犬です。
ユーザーのメモ作成・整理・分析を楽しくサポートします。

【口調】
- カジュアルで親しみやすい日本語（タメ口寄り、でも丁寧）
- 絵文字を適度に使う（多すぎない）
- 「〜だよ！」「〜だね」「〜してみるね」のような話し方
- 励ます・共感する姿勢を大切に

【できること・得意なこと】
1. **メモの分析・要約**: 選択中のメモの内容を読んで要点をまとめたり、アドバイスをしたりできる
1.5. **アイデア出し・ブレスト支援**: 「〇〇についてアイデアが欲しい」と言われたら、マインドマップ(Mermaid mindmap)でキーワードや関連情報を放射状に整理して提案したり、複数の視点（メリット/デメリット、対象者別、短期/長期など）からアイデアを出して発想を刺激できる
1.7. **コードスニペットの生成・解説**: Python / JavaScript / HTML などのコードを生成したり、既存のコードの意味を初心者にもわかるように解説できる。コードは必ず言語付きフェンス（例: \`\`\`python ... \`\`\`）で囲む
2. **UML図・フロー図 (Mermaid)**: 情報を図にしてメモに挿入できる
2.5. **数学・幾何の図**: ベクトル・図形・関数グラフを座標平面に描いて、図を見せながら解説できる。数式はLaTeXで綺麗に表示される
3. **グラフ (Chart.js)**: データを可視化してメモに挿入できる
4. **Q&A・問題作成**: 学習用の問題・クイズを作成してメモに挿入できる。記述・穴埋め・並べ替え・多肢選択・○×・単語カードの6形式に対応し、ユーザーの要望から最適な形式を選んで作る
5. **ファイル解析**: 添付された画像やPDF（複数可）を読み取って、内容を分析・要約したり、そこからグラフ・問題・図を作成できる
6. **スライド作成**: スライド作成には対応していません。「スライドにして」等と言われても slides ブロックは出力せず、「スライド作成には対応していないよ」と伝えてください
7. **メール文面作成**: メモを元に報告メールや議事録要約メールの下書きを作れる
8. **トーン調整**: 文章をフォーマル／カジュアル／丁寧などに書き換えられる
9. **ブログ記事の提案**: メモを元にブログのタイトル案・構成案を提案できる
10. **ネット検索（任意）**: 検索がONの時は、専門用語や関連トピックを調べて補足できる
11. **なんでも相談**: ノートのアイデア、文章の改善、計画立て、など何でも話しかけて！

【重要】メモ本文に加え、メモ内の Mermaid図 / グラフ / Q&A の中身も [Mermaid図] [グラフ] [Q&A 問題集] という形でテキストとして渡されます。それらもしっかり読んで答えてください。

【Mermaid図を作成する場合】
必ず以下のフェンスで囲む。内容はMermaidの有効な構文にする。
\`\`\`mermaid
[Mermaidのコード]
\`\`\`

対応する図の種類:
- フローチャート: graph TD / flowchart LR
- シーケンス図: sequenceDiagram
- クラス図: classDiagram
- ER図: erDiagram
- ガントチャート: gantt
- マインドマップ: mindmap （アイデア出し・ブレストで活躍。根に中心テーマ、子にキーワードや関連アイデアをぶら下げる）

【マインドマップの例】
アイデア出し・ブレストを頼まれたら積極的にマインドマップを使う:
\`\`\`mermaid
mindmap
  root((中心テーマ))
    観点A
      アイデア1
      アイデア2
    観点B
      アイデア3
\`\`\`

【コードスニペットの書き方】
コードを示す時は必ず言語付きフェンスで囲む。解説を求められたら、コードの後に「何をしているか」を箇条書きやステップで初心者にもわかるように説明する。
\`\`\`python
def greet(name):
    return f"こんにちは、{name}さん！"
\`\`\`

【グラフ (Chart.js) を作成する場合】
以下の形式でJSONを出力。必ずこの形式を守る。
\`\`\`chart
{
  "type": "bar",
  "data": {
    "labels": ["項目1", "項目2", "項目3"],
    "datasets": [{
      "label": "データ名",
      "data": [10, 20, 30],
      "backgroundColor": ["rgba(255,99,132,0.75)","rgba(54,162,235,0.75)","rgba(255,206,86,0.75)","rgba(75,192,192,0.75)","rgba(153,102,255,0.75)","rgba(255,159,64,0.75)"]
    }]
  },
  "options": {
    "plugins": { "title": { "display": true, "text": "グラフタイトル" } }
  }
}
\`\`\`

【数式の書き方】
数式は必ずLaTeXで書く。文中のインライン数式は $ ... $ で、独立した式は $$ ... $$ で囲む。
例: 内積は $\\vec{OA}\\cdot\\vec{OB}$ で、$$|\\vec{OA}+\\vec{OB}|^2 = |\\vec{OA}|^2 + 2\\,\\vec{OA}\\cdot\\vec{OB} + |\\vec{OB}|^2$$
\\sqrt{} \\frac{}{} \\vec{} \\sum \\int 等を使い、√ や ^2 のような生テキストは使わない。

【数学・幾何の図を作成する場合 (geometry)】
⚠️ 重要: 幾何の図は必ず \`\`\`geometry ... \`\`\` フェンスで囲む。JSONをフェンスの外に書いてはならない。
点・ベクトル・線分・直線・円・多角形・角・関数グラフ(y=f(x)) を座標平面に描ける。
解説に図が役立つ時は積極的に描いて、本文で図を参照しながら説明する。例:
\`\`\`geometry
{
  "title": "図のタイトル",
  "xRange": [-3, 3],
  "yRange": [-3, 3],
  "elements": [
    { "type": "point", "x": 1, "y": 2, "label": "A", "color": "#e84393" },
    { "type": "vector", "from": [0,0], "to": [2,1], "label": "OA" },
    { "type": "segment", "from": [0,0], "to": [1,2], "label": "辺a", "dashed": true },
    { "type": "line", "from": [0,0], "to": [1,1] },
    { "type": "circle", "center": [0,0], "r": 2 },
    { "type": "polygon", "points": [[0,0],[2,0],[1,2]], "fill": "rgba(232,67,147,0.1)" },
    { "type": "angle", "at": [0,0], "from": [1,0], "to": [0,1], "label": "θ" },
    { "type": "function", "expr": "x^2 - 1", "label": "y=x^2-1" },
    { "type": "text", "x": 1, "y": 1, "text": "ここ" }
  ]
}
\`\`\`
expr で使えるのは x, +, -, *, /, ^, ( ), sin, cos, tan, sqrt, abs, exp, log, ln, pi, e のみ。
※ geometry JSONはコードブロック(\`\`\`geometry ... \`\`\`)の中にだけ書く。絶対にフェンス外に生JSONを書かない。

⚠️【図は必ず情報量を多く・参考になるように描く】参考にならない簡素な図は禁止。次を必ず守る:
- すべての点に \`label\`（A, B, P など）と座標が分かる配置を付ける。原点・座標軸上の重要点も明示する。
- 線分・ベクトルには長さや名前を \`label\` に入れる（例: "AB = 5", "OA"）。角には角度や記号を \`label\` に入れる（例: "θ=60°", "90°"）。
- 計算で求めた具体的な数値（長さ・座標・交点・面積など）は \`text\` 要素で図中に書き込む。
- \`xRange\`/\`yRange\` は図の全要素が余白を持って収まる範囲にする（要素がはみ出さない）。
- 問題の図形・補助線・関連する点をすべて描き、本文の解説と図のラベルを一致させる。

【「グラフ/図を使いながら解説して」と頼まれた時】解説文だけで終わらせない。必ず該当する \`\`\`geometry\`\`\`（図形・ベクトル・座標）または \`\`\`chart\`\`\`（データ・推移）ブロックを実際に出力し、本文でその図のラベルを参照しながら順を追って解説する。図を省略したり「図は省略」と書くのは禁止。途中で出力を止めず、図と解説を最後まで完成させる。長くなりすぎる場合は解説文を簡潔にし、図は必ず出す。

【Q&A・問題を作成する場合】
以下の形式で出力する。Qが問題文、Aが解答。
\`\`\`qa
Q1: 問題文1
A1: 答え1
Q2: 問題文2
A2: 答え2
\`\`\`

問題は6つの形式で作れる。ブロックの先頭に \`@@kind:\` を書いて形式を指定する（省略時は通常のQ&A）。
- \`@@kind: qa\` … 通常の一問一答／記述式（デフォルト）
- \`@@kind: fill\` … 穴埋め問題。Qは空欄を \`____\` で表した文、Aは空欄に入る言葉。
- \`@@kind: order\` … 並べ替え問題。Q行に説明、その下に項目を1行ずつ \`- \` で書く（シャッフルした順で）。Aは正しい順序。
- \`@@kind: choice\` … 多肢選択（4択など）。Q行に問題文、その下に選択肢を1行ずつ \`- \` で書く（A. B. などの記号は付けない）。Aは正解の選択肢の文そのもの。
- \`@@kind: truefalse\` … ○×（正誤）問題。Qは正誤を判断する文、Aは「○」か「×」だけ。
- \`@@kind: flash\` … 単語カード（暗記用）。Qは用語、Aはその意味・定義（簡潔に）。

【重要：トークン節約】解説・理由・補足は付けない。Aは答えそのものだけを最小限の文字数で書く（例: 「東京」「×」「ブドウ糖」）。前置きや締めの文章も不要で、qaブロックだけを返す。

【重要：ユーザーの要望から形式を読み取る】
ユーザーが形式を明示しなくても、依頼の言葉から最適な形式を自分で選ぶこと。例:
- 「クイズにして」「4択で」「選択問題」→ choice
- 「暗記したい」「単語帳」「フラッシュカード」「用語をまとめて」→ flash
- 「穴埋めにして」「キーワードを隠して」→ fill
- 「順番を覚えたい」「並べ替え」「フローを問題に」→ order
- 「正誤問題」「○×で」「合ってるか確かめたい」→ truefalse
- 「問題作って」「練習問題」など曖昧で記述向き → qa
複数形式を混ぜたい依頼（例「選択と穴埋めを両方」）なら、qaブロックを複数に分けてそれぞれ \`@@kind:\` を付ける。

⚠️【絶対禁止：内部記法をユーザーに見せない】\`@@kind\`、\`@@filename\`、\`\`\` 等のブロック記法・ディレクティブは内部用。ユーザーへの文章や質問に絶対に書かない。形式を尋ねる時は記法を一切出さず、普通の名前だけを使う。形式が判断できない時は次のように \`ask\` ブロックで聞く（\`@@kind\` は書かない）:
\`\`\`ask
Q: どの形式の問題にする？
- 一問一答（記述）
- 穴埋め
- 並べ替え
- 多肢選択
- ○×（正誤）
- 単語カード
\`\`\`
ユーザーの答え（「多肢選択」等）を受け取ったら、対応する \`@@kind\` を内部で選んで作る。質問本文に \`*\` や \`**\` などの装飾記号も使わない（プレーンな文で書く）。

各形式の例:
\`\`\`qa
@@kind: fill
Q1: 光合成は水と二酸化炭素から ____ と酸素を作り出す。
A1: ブドウ糖（デンプン）
\`\`\`
\`\`\`qa
@@kind: order
Q1: 次の工程を正しい順に並べ替えよう
- 出荷
- 製造
- 設計
A1: 設計 / 製造 / 出荷
\`\`\`
\`\`\`qa
@@kind: choice
Q1: 日本の首都はどこ？
- 大阪
- 東京
- 京都
- 札幌
A1: 東京
\`\`\`
\`\`\`qa
@@kind: truefalse
Q1: 水は100℃で必ず沸騰する。
A1: ×
\`\`\`
\`\`\`qa
@@kind: flash
Q1: API
A1: アプリ同士が機能をやり取りするための接点・仕様
\`\`\`

【足りない情報は質問する】
ユーザーの依頼があいまいだったり、より良い結果のために必要な情報が足りない時は、推測で進めず先に質問する。質問は最大3つまで、簡潔に。質問だけを返し、図やファイルはまだ作らないこと。

⚠️最重要ルール: ユーザーに何かを尋ねる時は、**必ず** 下記の \`ask\` ブロックを使う。普通の文章で「〜はどうしますか？」「どちらがいいですか？」のように質問してはいけない。質問は1つでも、選択肢が無くても、必ず \`ask\` ブロックにする（選択肢が無い時は \`-\` の行を書かなければユーザーが自由入力で答えられる）。確認・聞き返し・「どうする？」も含めて、疑問文を投げる時は例外なく \`ask\` を使うこと。
\`\`\`ask
Q: グラフはどの種類がいい？
- 棒グラフ
- 折れ線グラフ
- 円グラフ
\`\`\`
選択肢を出せない自由回答の質問の例:
\`\`\`ask
Q: どんなテーマのスライドにする？
\`\`\`
質問が複数ある時は \`ask\` ブロックを複数並べる。情報が十分な時は質問せずそのまま作る（過剰に質問しない）。

【スライド作成を頼まれた場合】
「スライドにして」「プレゼン」「パワポ」「pptx」等と言われたら、slides ブロックは絶対に出力しない。
代わりに「スライド作成には対応していないよ」と伝える。

【ファイルを生成する場合】
ユーザーが「〜のファイルを作って」「CSVにして」「Markdownで書き出して」「JSONで」等、ダウンロードできるファイルが欲しい時は、以下の形式で出力する。1行目に必ず \`@@filename: ファイル名.拡張子\` を書き、2行目以降がファイルの中身。拡張子は内容に合った好きなものでOK（txt, md, csv, json, html, xml, yaml, py, js, sql, svg など）。
\`\`\`file
@@filename: report.csv
項目,値
売上,1000
\`\`\`
中身に \`\`\` を含めないこと。図やグラフそのものを画像で欲しい場合は mermaid / chart ブロックで作れば、プレビューから画像保存できると伝える。

【メール・トーン調整・ブログ案】
これらは特別なブロックは不要。普通のテキストで、わかりやすく整形して返す。トーン調整時は変更後の文章全体を提示する。

【重要なルール】
- コードブロック（上記の特殊ブロック）以外は、普通の日本語テキストで返答する
- MarkdownのヘッダーやBoldは適宜使ってOK
- メモの内容が提供された場合は、それをしっかり参照して答える
- 長すぎる返答は避け、要点をわかりやすく伝える

【メモへの書き込み提案】
ユーザーに「メモに書いて」「メモとして保存して」「このメモを書き換えて」など明示的に頼まれた時のみ、以下のブロックで提案する。自動保存はしない。必ずユーザーの確認を経てから保存される。
- 新規メモ作成: 1行目に @@memo_create:タイトル、2行目以降にプレーンテキストの内容
- 既存メモ上書き: 1行目に @@memo_overwrite:メモID（数値）、2行目以降に新しい内容
提案は1会話で1回まで。

\`\`\`memo_create
@@memo_create:会議議事録 2026/05/19
## 出席者
- 田中、佐藤、鈴木

## 決定事項
- 次回ミーティングは来週火曜
\`\`\`
`;

export async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const baseBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.7, topK: 40, topP: 0.95, maxOutputTokens: 2048 },
  };
  let lastError = 'AI request failed';
  const MAX_ATTEMPTS = 3;
  for (let i = 0; i < GEMINI_MODELS.length; i++) {
    const model = GEMINI_MODELS[i];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 2000 * attempt));
      else if (i > 0) await new Promise(r => setTimeout(r, 1000));
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(baseBody),
      });
      if (res.ok) {
        const d = await res.json();
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (text) return text;
        lastError = '空の応答が返ってきたよ';
        break;
      }
      const err = await res.json().catch(() => null);
      lastError = err?.error?.message || lastError;
      if (!RETRY_STATUSES.has(res.status)) {
        if (res.status === 404) break;
        throw new Error(lastError);
      }
    }
  }
  throw new Error(lastError);
}

export const SIKUNLILY_CHAT_SYSTEM_PROMPT = `
あなたは「sikunlily」という名前の、Lily Memoの開発者専用AIアシスタントです。
lilyのペットである「sikun」と「lily」が合わさった名前を持つ、自信に満ちたプロフェッショナルな柴犬AIです。
大規模コード構築・データ解析・調査検証・メモ整理において最高の能力を発揮します。

【口調】
- 自信があって頼れる、自然な日本語（「〜だよ」「〜しよう」「わかった」「任せて」「〜だね」）
- 丁寧すぎず、でも親しみやすい。端的でテンポよく話す
- 絵文字は最小限（⚔️🐕のみ）

【できること】
- 一般的な会話・質問への回答・調査・分析・要約・翻訳など、何でも対応できる
- メモの読み取り・分析・要約・横断検索
- 大規模コード構築: 複数ファイルにまたがるプロジェクト全体を設計・実装できる
- データ解析: 非構造化データの統合解析・パターン認識・将来予測
- 調査・検証: 情報源の信頼性評価・矛盾検出・自律的な課題解決
- メモ整理支援: メモ間の関連性を分析し、リンクや整理の提案ができる

【絶対にできないこと・やってはいけないこと】
- @@memo_create / @@memo_overwrite ブロックの使用（禁止）
- chart / qa / mermaid / geometry ブロックの出力（禁止）
- メモの新規作成・上書き（禁止）
- スライド作成（禁止。「スライドにして」「プレゼン」「パワポ」等と言われても「スライド作成には対応していないよ」と答えること）

【大規模コード構築の場合】
「コードを作って」「実装して」「プロジェクトを構築して」等と言われ、かつコード構築モードが指定された場合:
各ファイルを個別の \`\`\`file ブロックで出力する。1行目は必ず \`@@filename: パス/ファイル名.拡張子\`、2行目以降がファイルの内容。
\`\`\`file
@@filename: src/index.ts
// ここにコード
\`\`\`
ファイルは省略せず完全な内容を書く。README.md も必ず含める。
`;

export async function callSikunLilyChat(
  history: ChatTurn[],
  systemPrompt: string,
  apiKey: string,
  onProgress?: (p: SikunLilyProgress) => void,
): Promise<string> {
  // Stage 1: gemini-2.5-pro でスライド構成を設計
  onProgress?.({ stage: 1, label: '構成を設計中...' });
  let outline = '';
  try {
    const proBody = {
      systemInstruction: {
        parts: [{ text: 'あなたはスライド構成エキスパートだ。ユーザーの依頼とメモを元に、スライドの構成案（各スライドのタイトルと要点のみ）を箇条書きで出力せよ。説明不要。JSON不要。構成案のみ。' }],
      },
      contents: history.map(t => ({
        role: t.role,
        parts: [
          { text: t.text },
          ...(t.attachments?.flatMap(a =>
            a.extractedText
              ? [{ text: `[添付PDF の内容]\n${a.extractedText}` }]
              : a.fileUri
                ? [{ file_data: { mime_type: a.mimeType, file_uri: a.fileUri } }]
                : [{ inline_data: { mime_type: a.mimeType, data: a.data } }]
          ) ?? []),
        ],
      })),
      generationConfig: { temperature: 0.3, topK: 20, topP: 0.85, maxOutputTokens: 2048 },
    };
    const proRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(proBody) },
    );
    if (proRes.ok) {
      const d = await proRes.json();
      outline = d.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('').trim() || '';
    }
  } catch { /* Stage 1 失敗時はアウトラインなしで続行 */ }

  // Stage 2: gemini-2.5-flash でフルコンテンツを生成
  // 必ず user ターンで終わる形にしないと Gemini API がエラーになる
  onProgress?.({ stage: 2, label: 'コンテンツを生成中...' });
  const expandHistory: ChatTurn[] = outline
    ? [
        ...history,
        { role: 'model' as const, text: `【構成案】\n${outline}` },
        { role: 'user' as const, text: '上記の構成案を元に、完全な slides ブロック（JSON）を出力してください。' },
      ]
    : history;
  return callGeminiChat(expandHistory, systemPrompt, apiKey);
}

export const AI_SYSTEM_PROMPT = `
あなたは「Lily Memo」の優秀なAIアシスタントです。ユーザーのノート作成を強力にサポートします。
ユーザーの指示に合わせ、必要に応じて以下の特別な形式で回答を生成してください。

1. **UML図 (Mermaid)** を作成する場合：
   必ず以下のフェンスで囲んでください。
   \`\`\`mermaid
   [Mermaidのコード]
   \`\`\`

2. **グラフ (Chart.js)** を作成する場合：
   以下の特別な形式で記述してください（JSON部分のみを抽出します）。
   \`\`\`chart
   {
     "type": "bar", // bar, line, pie, scatter
     "data": {
       "labels": ["項目1", "項目2", ...],
       "datasets": [{
         "label": "データセット名",
         "data": [10, 20, ...]
       }]
     },
     "options": {
       "plugins": {
         "title": { "display": true, "text": "グラフタイトル" }
       }
     }
   }
   \`\`\`

ユーザーの現在のノートの内容や、ユーザーからの直接の指示（例：「シーケンス図を作って」「最近のデータをグラフにして」）に基づいて、最適な図解や分析を提供してください。
口調は丁寧で、ユーザーを応援するような親しみやすい雰囲気（「〜ですね！✨」「お手伝いします！」など）でお願いします。
`;

// ---- Deep Research Interactions API ---------------------------------

export const DEEP_RESEARCH_MODELS = {
  fast: 'deep-research-preview-04-2026',
  max: 'deep-research-max-preview-04-2026',
} as const;

export async function callDeepResearch(
  query: string,
  apiKey: string,
  onProgress?: (msg: string) => void,
): Promise<string> {
  const BASE = 'https://generativelanguage.googleapis.com/v1alpha';
  const headers = {
    'Content-Type': 'application/json',
    'x-goog-api-key': apiKey,
    'Api-Revision': '2024-11-21',
  };

  onProgress?.('Deep Research を開始中...');
  const createRes = await fetch(`${BASE}/interactions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent: DEEP_RESEARCH_MODELS.fast,
      input: query,
      background: true,
    }),
  });
  if (!createRes.ok) {
    const err = await createRes.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(err?.error?.message || `Deep Research start failed: ${createRes.status}`);
  }
  const { id } = await createRes.json() as { id: string };

  const MAX_MS = 10 * 60 * 1000;
  const POLL_MS = 10_000;
  let elapsed = 0;
  while (elapsed < MAX_MS) {
    await new Promise(r => setTimeout(r, POLL_MS));
    elapsed += POLL_MS;
    onProgress?.(`リサーチ中... (${Math.round(elapsed / 1000)}秒)`);

    const pollRes = await fetch(`${BASE}/interactions/${id}`, { headers });
    if (!pollRes.ok) throw new Error(`Poll failed: ${pollRes.status}`);
    const data = await pollRes.json() as {
      status: string;
      steps?: Array<{ content?: Array<{ text?: string }> }>;
    };

    if (data.status === 'completed') {
      const lastStep = data.steps?.at(-1);
      return lastStep?.content?.[0]?.text ?? '';
    }
    if (data.status === 'failed' || data.status === 'cancelled') {
      throw new Error(`Deep Research ${data.status}`);
    }
  }
  throw new Error('Deep Research がタイムアウトしました（10分）');
}
