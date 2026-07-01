// Generates an always-current description of the app's plan/mode/quota
// system for injection into AI system prompts (Lily chat, instance sikun).
// Built from the live constants in points.ts instead of being hand-written,
// so it can't silently go stale the way a hardcoded prompt block would.
import {
  PLAN_ORDER, PLAN_LABEL, PLAN_PRICE_YEN, PLAN_DAILY_POINTS,
  PLAN_THINKING_TICKETS, PLAN_ULTRA_TICKETS, PLAN_EXERCISE_TICKETS, PLAN_LESSON_TICKETS,
  ptToTokens, formatTokens,
} from '@/lib/points';

export function buildAppKnowledgeText(): string {
  const planLines = PLAN_ORDER.map(plan => {
    if (plan === 'developer') {
      return '- Developer: 開発者専用パスワードで解放。トークン予算は無制限だが、日付が変わると自動的にFreeへ失効するため毎日パスワードの再入力が必要。';
    }
    const price = PLAN_PRICE_YEN[plan] === 0 ? '無料' : `¥${PLAN_PRICE_YEN[plan]}/月`;
    return `- ${PLAN_LABEL[plan]}: ${price}・1日あたり約${formatTokens(ptToTokens(PLAN_DAILY_POINTS[plan]))}トークン相当（Free以外の有料プランは毎月1日に自動でFreeへ戻る）`;
  }).join('\n');

  return `
【このアプリの現在の仕様（必ずこれを正しい情報として回答すること。古い記憶やありがちな一般論で答えないこと）】

■ プラン（トークン予算は毎日0時にリセット）
${planLines}

■ チャットの応答モード（チャット画面右上のメニューから切り替え）
- 🪶軽量モード: 最も低コスト・高速。品質は下がる。全プランのデフォルト。
- 🌸安定モード: 標準品質。Freeプランは1日1回しか使えない（使い切ると自動的に軽量モードへ切り替わる）。Free以外のプランは回数制限なし（1日のトークン予算内で利用可）。
- 🧠思考モード: Freeプランでは利用不可。それ以外のプランは1日${PLAN_THINKING_TICKETS.plus}回まで（Developerは無制限）。
- ⚡Ultra思考モード: Freeプランでは利用不可。それ以外のプランは1日${PLAN_ULTRA_TICKETS.plus}回まで（Developerは無制限）。
- 思考・Ultra思考は1日の回数を使い切ると、その日はその日付が変わるまで選択できなくなり、自動的に軽量モードへ切り替わる。

■ 演習タブ（メモ・チャットとは別の独立したタブ）
- 「Lilyに問題を作ってもらう」（問題作成）: Freeは1日${PLAN_EXERCISE_TICKETS.free}回、それ以外のプランは1日${PLAN_EXERCISE_TICKETS.plus}回まで。
- 「授業」: 全プラン共通で1日${PLAN_LESSON_TICKETS.free}回まで（Developerも例外なし）。
- チャット画面にあった、マイクで音声を録音して要約する授業機能は廃止済み。現在は存在しない。演習タブの「授業」（テキスト対話形式）が唯一の授業機能。

■ データ保存
- メモ・フォルダはブラウザのローカルIndexedDBにのみ保存され、何も設定しなければ他の端末とは同期されない。
- 設定画面の「自動同期」で共有キーを設定すると、同じキーを入れた端末同士でメモ・フォルダ・勉強記録が自動同期される（変更から約30秒以内に反映）。任意機能で、デフォルトはオフ。
- 自動同期を使わない場合でも、設定画面の「バックアップをダウンロード」でJSONを書き出し、別端末で「復元ファイルをアップロード」して取り込むことができる。
`.trim();
}
