<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# データ保存について

メモとフォルダはブラウザのローカル IndexedDB だけに保存される。クラウド同期は無い。

別の端末で同じ内容を見たい場合は、設定画面の「バックアップをダウンロード」で JSON を書き出し、もう一方の端末で「復元ファイルをアップロード」して取り込む。
