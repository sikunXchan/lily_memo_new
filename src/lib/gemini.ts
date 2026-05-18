export interface ChatAttachment {
  mimeType: string;
  data: string; // base64 without the data: prefix
}

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  attachments?: ChatAttachment[];
}

// Free-tier quotas differ per model and Google changes them over time, so we
// try models in order and fall back to the next one on a 429 (quota) error.
const GEMINI_MODELS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
];

export interface ChatOptions {
  webSearch?: boolean;
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
        ...(t.attachments?.map(a => ({
          inline_data: { mime_type: a.mimeType, data: a.data },
        })) ?? []),
      ],
    })),
    generationConfig: {
      temperature: 0.8,
      topK: 40,
      topP: 0.95,
      maxOutputTokens: 4096,
    },
  };

  let lastError = 'AI request failed';

  for (const model of GEMINI_MODELS) {
    // Google Search grounding is only reliable on the 2.x models, so we
    // only attach the tool there; the 1.5 fallback runs without it.
    const useSearch = options.webSearch && !model.includes('1.5');
    const body = JSON.stringify(
      useSearch ? { ...baseBody, tools: [{ google_search: {} }] } : baseBody
    );

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
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
      // Empty / non-text response (safety block etc.) → try next model.
      lastError = data.candidates?.[0]?.finishReason
        ? `応答を生成できなかったよ (${data.candidates[0].finishReason})`
        : '空の応答が返ってきたよ';
      continue;
    }

    const error = await response.json().catch(() => null);
    lastError = error?.error?.message || lastError;

    // 429 = quota exceeded for this model → try the next one.
    // Any other error (bad key, bad request) won't be fixed by retrying.
    if (response.status !== 429) {
      throw new Error(lastError);
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
2. **UML図・フロー図 (Mermaid)**: 情報を図にしてメモに挿入できる
3. **グラフ (Chart.js)**: データを可視化してメモに挿入できる
4. **Q&A・問題作成**: 学習用の問題・クイズを作成してメモに挿入できる
5. **ファイル解析**: 添付された画像やPDF（複数可）を読み取って、内容を分析・要約したり、そこからグラフ・問題・図を作成できる
6. **スライド作成**: メモや会話の内容をプレゼン用スライド（PowerPoint .pptx で保存可能）にまとめられる
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
      "backgroundColor": ["rgba(255,182,193,0.7)", "rgba(135,206,250,0.7)", "rgba(144,238,144,0.7)"]
    }]
  },
  "options": {
    "plugins": { "title": { "display": true, "text": "グラフタイトル" } }
  }
}
\`\`\`

【Q&A・問題を作成する場合】
以下の形式で出力する。Qが問題文、Aが解答。
\`\`\`qa
Q1: 問題文1
A1: 答え1
Q2: 問題文2
A2: 答え2
\`\`\`

【スライド (プレゼン) を作成する場合】
ユーザーが「スライドにして」「プレゼンにして」「パワポにして」「pptxで」等と言ったら、以下の形式で出力する。\`---\` だけの行でスライドを区切る。最初のスライドはタイトル用。
\`\`\`slides
# プレゼンのタイトル
---
## 1枚目の見出し
- 箇条書きポイント1
- 箇条書きポイント2
---
## 2枚目の見出し
- ポイント
\`\`\`

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
`;

export async function callGemini(prompt: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      }
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'AI request failed');
  }

  const data = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || '';
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
