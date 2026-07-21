// 図解（イラスト図解）で使う「素材」= アイコン集。
//
// 実体はユーザーが用意した 6 枚のスプライトシート（public/図解/*.png、各 5×5 の
// 光沢アイコン）を軽量 WebP に縮小したもの（public/zukai/s1..s6.webp）。AI は
// 素材キー（'server' / 'pc' / 'phishing' …）で必要な素材を選び、illustDiagram.ts
// のレンダラが該当セルをネスト SVG の viewBox で切り出してノードに配置する。
//
// シートに無い概念（攻撃者・Cookie など）はインライン SVG グリフでフォールバック。

export interface IconSheet { file: string; w: number; h: number; cols: number; rows: number; }

// 縮小済み WebP シート。元画像は 1448×1086、5×5 グリッド。
export const ICON_SHEETS: Record<string, IconSheet> = {
  s1: { file: '/zukai/s1.webp', w: 900, h: 675, cols: 5, rows: 5 },
  s2: { file: '/zukai/s2.webp', w: 900, h: 675, cols: 5, rows: 5 },
  s3: { file: '/zukai/s3.webp', w: 900, h: 675, cols: 5, rows: 5 },
  s4: { file: '/zukai/s4.webp', w: 900, h: 675, cols: 5, rows: 5 },
  s5: { file: '/zukai/s5.webp', w: 900, h: 675, cols: 5, rows: 5 },
  s6: { file: '/zukai/s6.webp', w: 900, h: 675, cols: 5, rows: 5 },
};

export interface RasterIcon { key: string; sheet: string; r: number; c: number; label: string; en: string; keywords: string; }

// [key, sheet, row(0-4), col(0-4), 日本語ラベル, English, keywords]
const RASTER_LIST: [string, string, number, number, string, string, string][] = [
  // ── s1: 一般IT・ネットワーク ──
  ['cloud', 's1', 0, 0, 'クラウド', 'Cloud', 'cloud internet クラウド'],
  ['server', 's1', 0, 1, 'サーバー', 'Server', 'server host backend サーバー ホスト'],
  ['database', 's1', 0, 2, 'データベース', 'Database', 'database db store データベース 保存'],
  ['router', 's1', 0, 3, 'ルーター', 'Router', 'router gateway wifi ルーター 回線 中継'],
  ['switch', 's1', 0, 4, 'スイッチ / ハブ', 'Switch', 'switch hub lan スイッチ ハブ 集線'],
  ['firewall', 's1', 1, 0, 'ファイアウォール', 'Firewall', 'firewall wall block 防火壁 遮断 防御'],
  ['laptop', 's1', 1, 1, 'ノートパソコン', 'Laptop', 'laptop client ノートPC 端末 クライアント'],
  ['pc', 's1', 1, 2, 'デスクトップPC', 'Desktop PC', 'pc desktop computer パソコン 端末'],
  ['smartphone', 's1', 1, 3, 'スマートフォン', 'Smartphone', 'smartphone phone mobile スマホ 携帯'],
  ['tablet', 's1', 1, 4, 'タブレット', 'Tablet', 'tablet ipad タブレット 端末'],
  ['wifi', 's1', 2, 0, '無線 / Wi-Fi', 'Wi-Fi', 'wifi wireless signal 無線 電波 通信'],
  ['globe', 's1', 2, 1, 'インターネット / 世界', 'Internet', 'internet globe world web インターネット 世界 網'],
  ['lock', 's1', 2, 2, '鍵（ロック）', 'Lock', 'lock secure encrypted 施錠 暗号 保護'],
  ['key', 's1', 2, 3, '鍵（キー）', 'Key', 'key credential password 鍵 認証 パスワード'],
  ['user', 's1', 2, 4, 'ユーザー / 利用者', 'User', 'user person client 人 利用者 ユーザ'],
  ['users', 's1', 3, 0, '複数ユーザー / グループ', 'Users', 'users group people 複数 グループ 集団'],
  ['folder', 's1', 3, 1, 'フォルダ', 'Folder', 'folder directory フォルダ 格納'],
  ['document', 's1', 3, 2, '書類 / ファイル', 'Document', 'document file page 書類 ファイル 文書'],
  ['email', 's1', 3, 3, 'メール', 'Email', 'email mail message メール 手紙 送信'],
  ['printer', 's1', 3, 4, 'プリンター', 'Printer', 'printer print プリンタ 印刷'],
  ['sync', 's1', 4, 0, '同期 / 更新', 'Sync', 'sync refresh update 同期 更新 循環'],
  ['nas', 's1', 4, 1, 'NAS / ストレージ', 'NAS', 'nas storage ストレージ 保管'],
  ['harddisk', 's1', 4, 2, 'ハードディスク', 'Hard disk', 'harddisk hdd disk ディスク 記憶'],
  ['cctv', 's1', 4, 3, '監視カメラ', 'CCTV', 'cctv camera surveillance 監視 カメラ'],
  ['headset', 's1', 4, 4, 'ヘッドセット', 'Headset', 'headset support call ヘッドセット 通話'],
  // ── s2: 開発・クラウド・データ ──
  ['cloud_upload', 's2', 0, 0, 'アップロード', 'Upload', 'upload cloud 送信 アップロード'],
  ['cloud_download', 's2', 0, 1, 'ダウンロード', 'Download', 'download cloud 受信 ダウンロード'],
  ['webpage', 's2', 0, 2, 'Webページ', 'Web page', 'webpage site content ページ サイト 画面'],
  ['browser', 's2', 0, 3, 'ブラウザ', 'Browser', 'browser web url ブラウザ ウェブ'],
  ['api', 's2', 0, 4, 'API', 'API', 'api endpoint interface 連携 インターフェース'],
  ['blockchain', 's2', 1, 0, 'ブロックチェーン', 'Blockchain', 'blockchain distributed ブロックチェーン 分散台帳'],
  ['container', 's2', 1, 1, 'コンテナ', 'Container', 'container docker コンテナ'],
  ['module', 's2', 1, 2, 'モジュール / ボックス', 'Module', 'module box component 部品 モジュール'],
  ['hierarchy', 's2', 1, 3, '階層 / 組織図', 'Hierarchy', 'hierarchy tree org 階層 組織 木構造'],
  ['network', 's2', 1, 4, 'ネットワーク', 'Network', 'network mesh nodes ネットワーク 網 接続'],
  ['cache', 's2', 2, 0, 'キャッシュ / 高速DB', 'Cache', 'cache redis fast キャッシュ 高速'],
  ['message_queue', 's2', 2, 1, 'メッセージキュー', 'Message queue', 'queue kafka message キュー メッセージ 待ち行列'],
  ['bar_chart', 's2', 2, 2, '棒グラフ', 'Bar chart', 'bar chart growth 棒グラフ 成長'],
  ['dashboard', 's2', 2, 3, 'ダッシュボード', 'Dashboard', 'dashboard analytics ダッシュボード 分析'],
  ['search', 's2', 2, 4, '検索 / スキャン', 'Search', 'search scan 検索 走査 探索'],
  ['gear', 's2', 3, 0, '処理 / 設定', 'Process', 'gear settings process 処理 設定 歯車'],
  ['code', 's2', 3, 1, 'コード', 'Code', 'code program コード プログラム'],
  ['terminal', 's2', 3, 2, 'ターミナル / コンソール', 'Terminal', 'terminal console shell ターミナル 端末'],
  ['bug', 's2', 3, 3, 'バグ / 不具合', 'Bug', 'bug error defect バグ 不具合 障害'],
  ['pipeline', 's2', 3, 4, 'パイプライン', 'Pipeline', 'pipeline flow steps パイプライン 流れ 工程'],
  ['ai_chip', 's2', 4, 0, 'AIチップ / AI', 'AI chip', 'ai chip cpu 人工知能 AI 半導体'],
  ['robot', 's2', 4, 1, 'ロボット / ボット', 'Robot', 'robot bot ai ロボット ボット'],
  ['bell', 's2', 4, 2, '通知', 'Notification', 'bell notification alert 通知 お知らせ'],
  ['shield_check', 's2', 4, 3, '保護 / 安全', 'Protected', 'shield secure safe 保護 安全 盾'],
  ['satellite', 's2', 4, 4, '衛星 / 通信', 'Satellite', 'satellite comms 衛星 通信'],
  // ── s3: データ・ML・分析 ──
  ['data_warehouse', 's3', 0, 0, 'データウェアハウス', 'Data warehouse', 'warehouse dwh データウェアハウス 倉庫'],
  ['data_lake', 's3', 0, 1, 'データレイク', 'Data lake', 'data lake データレイク'],
  ['etl', 's3', 0, 2, 'ETL / 変換', 'ETL', 'etl transform 変換 加工'],
  ['data_pipe', 's3', 0, 3, 'データパイプ', 'Data pipe', 'pipe transfer パイプ 転送'],
  ['data_scatter', 's3', 0, 4, 'データ点群', 'Data points', 'data points scatter データ 点群 分布'],
  ['gauge', 's3', 1, 0, 'メーター', 'Gauge', 'gauge meter speed メーター 計測 負荷'],
  ['line_chart', 's3', 1, 1, '折れ線グラフ', 'Line chart', 'line chart trend 折れ線 推移'],
  ['pie_chart', 's3', 1, 2, '円グラフ', 'Pie chart', 'pie chart ratio 円グラフ 割合'],
  ['heatmap', 's3', 1, 3, 'ヒートマップ', 'Heatmap', 'heatmap grid ヒートマップ'],
  ['forecast', 's3', 1, 4, '予測', 'Forecast', 'forecast predict 予測 未来'],
  ['knowledge_graph', 's3', 2, 0, 'ナレッジグラフ', 'Knowledge graph', 'knowledge graph ナレッジ グラフ'],
  ['neural_network', 's3', 2, 1, 'ニューラルネット', 'Neural net', 'neural network ai ニューラル 学習'],
  ['chatbot', 's3', 2, 2, 'チャットボット', 'Chatbot', 'chatbot ai チャットボット 対話'],
  ['clustering', 's3', 2, 3, 'クラスタリング', 'Clustering', 'clustering group クラスタ 分類'],
  ['ocr', 's3', 2, 4, '文字認識 / OCR', 'OCR', 'ocr text recognition 文字認識'],
  ['document_ai', 's3', 3, 0, '文書AI', 'Document AI', 'document ai 文書 生成'],
  ['image', 's3', 3, 1, '画像', 'Image', 'image photo picture 画像 写真'],
  ['microphone', 's3', 3, 2, '音声 / マイク', 'Voice', 'microphone voice audio 音声 マイク'],
  ['database_relation', 's3', 3, 3, 'リレーショナルDB', 'Relational DB', 'relational db join リレーショナル 関係'],
  ['data_cube', 's3', 3, 4, 'データキューブ', 'Data cube', 'olap cube キューブ 多次元'],
  ['report', 's3', 4, 0, 'レポート', 'Report', 'report analytics レポート 報告'],
  ['image_labeling', 's3', 4, 1, '画像分類', 'Image labeling', 'image classify label 画像分類 ラベル'],
  ['anomaly', 's3', 4, 2, '異常検知', 'Anomaly', 'anomaly outlier 異常 検知'],
  ['trend_prediction', 's3', 4, 3, 'トレンド予測', 'Trend prediction', 'trend predict 予測 傾向'],
  ['decision_tree', 's3', 4, 4, '決定木 / ツリー', 'Decision tree', 'decision tree branch 決定木 分岐'],
  // ── s4: セキュリティ・認証 ──
  ['fingerprint', 's4', 0, 0, '指紋認証', 'Fingerprint', 'fingerprint biometric 指紋 生体認証'],
  ['two_factor', 's4', 0, 1, '二要素認証 / OTP', '2FA', 'otp 2fa mfa 二要素 ワンタイム'],
  ['fingerprint_reader', 's4', 0, 2, '指紋リーダー', 'Fingerprint reader', 'fingerprint scanner 指紋 読取'],
  ['face_recognition', 's4', 0, 3, '顔認証', 'Face recognition', 'face recognition 顔認証 生体'],
  ['cloud_security', 's4', 0, 4, 'クラウドセキュリティ', 'Cloud security', 'cloud security クラウド 保護'],
  ['id_card', 's4', 1, 0, 'IDカード', 'ID card', 'id card badge 身分証 認証情報'],
  ['access_control', 's4', 1, 1, 'アクセス制御', 'Access control', 'access control rbac アクセス 制御 権限'],
  ['permissions', 's4', 1, 2, '権限設定', 'Permissions', 'permissions roles 権限 許可'],
  ['confidential', 's4', 1, 3, '機密文書', 'Confidential', 'confidential secret 機密 秘密'],
  ['token', 's4', 1, 4, 'トークン / キーフォブ', 'Token', 'token fob jwt トークン 認可'],
  ['vpn', 's4', 2, 0, 'VPN / トンネル', 'VPN', 'vpn tunnel VPN トンネル 暗号化通信'],
  ['phishing', 's4', 2, 1, 'フィッシング / 攻撃メール', 'Phishing', 'phishing hook scam フィッシング 詐欺 罠'],
  ['spam_filter', 's4', 2, 2, 'スパムフィルタ', 'Spam filter', 'spam filter スパム 迷惑'],
  ['antivirus', 's4', 2, 3, 'ウイルス対策', 'Antivirus', 'antivirus malware ウイルス対策 マルウェア'],
  ['ransomware', 's4', 2, 4, 'ランサムウェア', 'Ransomware', 'ransomware lock money 身代金 暗号化'],
  ['radar', 's4', 3, 0, 'レーダー / 脅威検知', 'Radar', 'radar detection レーダー 探知'],
  ['soc_dashboard', 's4', 3, 1, '監視ダッシュボード', 'Monitoring', 'soc monitoring 監視 セキュリティ'],
  ['audit', 's4', 3, 2, '監査', 'Audit', 'audit log checklist 監査 記録'],
  ['compliance', 's4', 3, 3, 'コンプライアンス', 'Compliance', 'compliance policy 準拠 統制'],
  ['backup', 's4', 3, 4, 'バックアップ', 'Backup', 'backup cloud db バックアップ 複製'],
  ['secure_database', 's4', 4, 0, 'セキュアDB', 'Secure DB', 'secure database encrypted 暗号化 DB'],
  ['certificate', 's4', 4, 1, '証明書', 'Certificate', 'certificate ssl 証明書 認証局'],
  ['vault', 's4', 4, 2, '金庫 / 保管庫', 'Vault', 'vault safe secret 金庫 保管 秘密'],
  ['zero_trust', 's4', 4, 3, 'ゼロトラスト', 'Zero trust', 'zero trust ゼロトラスト 常時検証'],
  ['siren', 's4', 4, 4, 'アラート / 警報', 'Alert', 'siren alert alarm 警報 緊急'],
  // ── s5: クラウド・DevOps ──
  ['kubernetes', 's5', 0, 0, 'Kubernetes / オーケストレーション', 'Kubernetes', 'kubernetes k8s orchestration 制御'],
  ['microservices', 's5', 0, 1, 'マイクロサービス', 'Microservices', 'microservices マイクロサービス'],
  ['cicd', 's5', 0, 2, 'CI/CD', 'CI/CD', 'cicd pipeline 継続的 デプロイ'],
  ['deploy', 's5', 0, 3, 'デプロイ / リリース', 'Deploy', 'deploy release rocket デプロイ 公開'],
  ['git_branch', 's5', 0, 4, 'Gitブランチ', 'Git branch', 'git branch version ブランチ バージョン管理'],
  ['code_folder', 's5', 1, 0, 'コードフォルダ', 'Code folder', 'code repository リポジトリ ソース'],
  ['code_review', 's5', 1, 1, 'コードレビュー', 'Code review', 'code review レビュー 議論'],
  ['artifact', 's5', 1, 2, '成果物 / パッケージ', 'Artifact', 'artifact package build 成果物 パッケージ'],
  ['distributed', 's5', 1, 3, '分散システム', 'Distributed', 'distributed nodes 分散 ノード'],
  ['mesh', 's5', 1, 4, 'メッシュ', 'Mesh', 'mesh graph メッシュ 網'],
  ['serverless', 's5', 2, 0, 'サーバーレス', 'Serverless', 'serverless lambda function サーバーレス 関数'],
  ['cdn', 's5', 2, 1, 'CDN / 配信', 'CDN', 'cdn edge delivery 配信 エッジ'],
  ['global_server', 's5', 2, 2, 'グローバルサーバー', 'Global server', 'global server region 拠点 世界'],
  ['load_balancer', 's5', 2, 3, 'ロードバランサ', 'Load balancer', 'load balancer 分散 負荷分散'],
  ['auto_scaling', 's5', 2, 4, 'オートスケール', 'Auto scaling', 'autoscaling scale オートスケール 増減'],
  ['data_stream', 's5', 3, 0, 'データストリーム', 'Data stream', 'stream flow ストリーム 流れ'],
  ['fork', 's5', 3, 1, '分岐 / フォーク', 'Fork', 'fork branch split 分岐 二股'],
  ['webhook', 's5', 3, 2, 'Webhook', 'Webhook', 'webhook callback 連携 通知'],
  ['build', 's5', 3, 3, 'ビルド', 'Build', 'build compile ビルド 生成'],
  ['container_monitor', 's5', 3, 4, 'コンテナ監視', 'Container monitor', 'container monitor コンテナ 監視'],
  ['stack', 's5', 4, 0, 'スタック / 層', 'Stack', 'stack layers スタック 積層'],
  ['deploy_success', 's5', 4, 1, 'デプロイ成功', 'Deploy OK', 'deploy success 成功 完了'],
  ['safe', 's5', 4, 2, '金庫', 'Safe', 'safe vault 金庫 保護'],
  ['scheduler', 's5', 4, 3, 'スケジューラ', 'Scheduler', 'scheduler cron 定期 予定'],
  ['sync_nodes', 's5', 4, 4, 'ノード同期', 'Node sync', 'sync nodes 同期 連携'],
  // ── s6: ビジネス・一般 ──
  ['discussion', 's6', 0, 0, 'ディスカッション', 'Discussion', 'discussion chat talk 会話 議論'],
  ['video_call', 's6', 0, 1, 'ビデオ会議', 'Video call', 'video call meeting ビデオ会議 オンライン'],
  ['calendar', 's6', 0, 2, 'カレンダー', 'Calendar', 'calendar date カレンダー 日付'],
  ['kanban', 's6', 0, 3, 'カンバン', 'Kanban', 'kanban board task カンバン タスク'],
  ['checklist', 's6', 0, 4, 'チェックリスト', 'Checklist', 'checklist todo チェックリスト 一覧'],
  ['support_ticket', 's6', 1, 0, 'サポートチケット', 'Support ticket', 'ticket support チケット 問い合わせ'],
  ['profile_card', 's6', 1, 1, 'プロフィール', 'Profile', 'profile account プロフィール 個人'],
  ['supply_chain', 's6', 1, 2, 'サプライチェーン', 'Supply chain', 'supply chain logistics 物流 供給'],
  ['shopping_cart', 's6', 1, 3, 'ショッピングカート', 'Cart', 'cart shop purchase カート 購入'],
  ['credit_card', 's6', 1, 4, 'クレジットカード', 'Credit card', 'credit card payment カード 決済'],
  ['invoice', 's6', 2, 0, '請求書', 'Invoice', 'invoice receipt bill 請求 領収'],
  ['approval', 's6', 2, 1, '承認 / スタンプ', 'Approval', 'approval stamp 承認 押印'],
  ['workflow', 's6', 2, 2, 'ワークフロー', 'Workflow', 'workflow flow process ワークフロー 流れ'],
  ['timer', 's6', 2, 3, 'タイマー', 'Timer', 'timer stopwatch clock タイマー 時間'],
  ['location', 's6', 2, 4, '位置 / 地図ピン', 'Location', 'location map pin 位置 地図'],
  ['shop', 's6', 3, 0, '店舗', 'Shop', 'shop store 店舗 お店'],
  ['support_agent', 's6', 3, 1, 'サポート担当', 'Support agent', 'agent support オペレーター 担当'],
  ['mobile_app', 's6', 3, 2, 'モバイルアプリ', 'Mobile app', 'mobile app アプリ スマホ'],
  ['report_dashboard', 's6', 3, 3, 'レポート画面', 'Report screen', 'report dashboard レポート 画面'],
  ['wireless_router', 's6', 3, 4, '無線ルーター', 'Wireless router', 'router wifi 無線 ルーター'],
  ['robot_arm', 's6', 4, 0, '産業ロボット', 'Robot arm', 'robot arm factory 製造 ロボットアーム'],
  ['warehouse', 's6', 4, 1, '倉庫', 'Warehouse', 'warehouse inventory 倉庫 在庫'],
  ['barcode', 's6', 4, 2, 'バーコード', 'Barcode', 'barcode scanner バーコード 読取'],
  ['qrcode', 's6', 4, 3, 'QRコード', 'QR code', 'qr code QRコード'],
  ['document_sync', 's6', 4, 4, '書類同期 / 交換', 'Doc exchange', 'document sync exchange 同期 交換'],
];

export const RASTER_ICONS: Record<string, RasterIcon> = Object.fromEntries(
  RASTER_LIST.map(([key, sheet, r, c, label, en, keywords]) => [key, { key, sheet, r, c, label, en, keywords }])
);

// シートの該当セルの矩形（画像座標系）。切り出しはレンダラ側で「セルを少しだけ
// 内側にinsetした窓」を contain（アスペクト維持）でカードに収めるので、横長アイコン
// も切れず中央に載る。ここではセルの外形だけを返す。
export function iconCell(key: string): { sheet: IconSheet; sheetId: string; cellX: number; cellY: number; cellW: number; cellH: number } | null {
  const a = RASTER_ICONS[key];
  if (!a) return null;
  const sh = ICON_SHEETS[a.sheet];
  if (!sh) return null;
  const cellW = sh.w / sh.cols, cellH = sh.h / sh.rows;
  return { sheet: sh, sheetId: a.sheet, cellX: a.c * cellW, cellY: a.r * cellH, cellW, cellH };
}

/* ---------- SVG フォールバック（シートに無い概念用の線画グリフ） ---------- */
const S = (c: string) => `fill="none" stroke="${c}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"`;
const FILL = (c: string) => `fill="${c}" fill-opacity="0.16"`;
const DOT = (c: string) => `fill="${c}"`;

interface SvgIcon { label: string; en: string; keywords: string; draw: (c: string) => string; }

// 0..64 キャンバスの線画グリフ。ラスター素材に無いものだけを持つ。
const SVG_ICONS: Record<string, SvgIcon> = {
  attacker: {
    label: '攻撃者 / 不正利用者', en: 'Attacker', keywords: 'attacker hacker adversary 攻撃者 悪意 なりすまし 犯人',
    draw: c => `
      <circle cx="32" cy="22" r="9" ${FILL(c)}/>
      <circle cx="32" cy="22" r="9" ${S(c)}/>
      <path d="M17 49 a15 15 0 0 1 30 0" ${FILL(c)}/>
      <path d="M17 49 a15 15 0 0 1 30 0" ${S(c)}/>
      <rect x="23" y="19" width="18" height="5.4" rx="2.4" ${DOT(c)}/>`,
  },
  cookie: {
    label: 'クッキー / セッション', en: 'Cookie', keywords: 'cookie session token クッキー セッション 状態',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <circle cx="26" cy="27" r="2.1" ${DOT(c)}/>
      <circle cx="38" cy="26" r="1.7" ${DOT(c)}/>
      <circle cx="40" cy="37" r="2.1" ${DOT(c)}/>
      <circle cx="28" cy="39" r="1.7" ${DOT(c)}/>
      <circle cx="33" cy="33" r="1.7" ${DOT(c)}/>`,
  },
  shield: {
    label: '盾（防御）', en: 'Shield', keywords: 'shield defense guard 盾 防御 安全',
    draw: c => `
      <path d="M32 12 L48 18 V32 C48 42 40 49.5 32 52 C24 49.5 16 42 16 32 V18 Z" ${FILL(c)}/>
      <path d="M32 12 L48 18 V32 C48 42 40 49.5 32 52 C24 49.5 16 42 16 32 V18 Z" ${S(c)}/>
      <path d="M25 32 l5 5 l9 -11" ${S(c)}/>`,
  },
  warning: {
    label: '警告 / 危険', en: 'Warning', keywords: 'warning danger risk 警告 危険 注意',
    draw: c => `
      <path d="M32 13 L52 48 H12 Z" ${FILL(c)}/>
      <path d="M32 13 L52 48 H12 Z" ${S(c)}/>
      <line x1="32" y1="28" x2="32" y2="38" ${S(c)}/>
      <circle cx="32" cy="43" r="2.1" ${DOT(c)}/>`,
  },
  check: {
    label: 'OK / 正常', en: 'OK', keywords: 'ok check success safe 正常 成功 承認',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <path d="M23 33 l6 6 l12 -14" ${S(c)}/>`,
  },
  cross: {
    label: '拒否 / 遮断', en: 'Blocked', keywords: 'block deny reject 拒否 遮断 失敗',
    draw: c => `
      <circle cx="32" cy="32" r="18" ${FILL(c)}/>
      <circle cx="32" cy="32" r="18" ${S(c)}/>
      <path d="M25 25 L39 39 M39 25 L25 39" ${S(c)}/>`,
  },
  link: {
    label: 'リンク / URL', en: 'Link', keywords: 'link url hyperlink リンク 誘導 参照',
    draw: c => `
      <path d="M27 37 L20 44 a7.5 7.5 0 0 1 -10.6 -10.6 L16 27" ${S(c)}/>
      <path d="M37 27 L44 20 a7.5 7.5 0 0 1 10.6 10.6 L48 37" ${S(c)}/>
      <line x1="26" y1="38" x2="38" y2="26" ${S(c)}/>`,
  },
  arrow_right: {
    label: '矢印 / 流れ', en: 'Arrow', keywords: 'arrow flow direction 矢印 流れ 方向',
    draw: c => `
      <line x1="14" y1="32" x2="46" y2="32" ${S(c)}/>
      <path d="M38 24 L50 32 L38 40" ${S(c)}/>`,
  },
};

// key -> グリフ SVG。SVG フォールバック or 汎用（丸 + ？）。
export function illustGlyph(key: string, color: string): string {
  const asset = SVG_ICONS[key];
  if (asset) return asset.draw(color);
  return `
    <circle cx="32" cy="32" r="16" ${FILL(color)}/>
    <circle cx="32" cy="32" r="16" ${S(color)}/>
    <path d="M27 27 a5 5 0 1 1 6.5 6 c -1.5 1 -1.5 2 -1.5 3.5" ${S(color)}/>
    <circle cx="32" cy="43" r="1.8" ${DOT(color)}/>`;
}

// AI に渡す素材カタログ（key: 日本語ラベル）。ラスター素材＋SVGフォールバック。
export const ILLUST_MATERIAL_CATALOG: { key: string; label: string; keywords: string }[] = [
  ...RASTER_LIST.map(([key, , , , label, , keywords]) => ({ key, label, keywords })),
  ...Object.entries(SVG_ICONS).map(([key, v]) => ({ key, label: v.label, keywords: v.keywords })),
];

// 有効な素材キーの集合。
export const ILLUST_ASSET_KEYS = new Set<string>([
  ...RASTER_LIST.map(([key]) => key),
  ...Object.keys(SVG_ICONS),
]);
