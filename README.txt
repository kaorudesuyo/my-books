【サーバーに置くフォルダ構成】

  books.html            … 表示用アプリ
  books.xlsx            … 本のデータ（★これを編集する）
  books.csv             … 予備データ（xlsxが読めない時だけ使われる）
  lib/
    xlsx.full.min.js    … Excel読み込みライブラリ（同梱・編集不要）
  cover/
    1.jpg 〜 100.jpg    … 書影画像（自分で用意する）

※ books.html / books.xlsx / lib / cover はすべて同じ階層に置いてください。


【データの更新方法】

1. books.xlsx を Excel で開いて編集・保存
2. サーバー上の books.xlsx を差し替える
3. ブラウザをリロード → 反映されます

CSVへの書き出しは不要です。アプリが books.xlsx を直接読みます。

■ Excelの列（1行目のヘッダーは変更しないでください）
  id / title / author / genre / cover / amazonUrl / review

■ 注意
  ・シートは一番左のシートが読まれます
  ・cover列は「cover/1.jpg」のようにパスで記入
  ・cover列が空の本はタイトル文字のカードとして表示されます


【動作確認について】

books.html をダブルクリックで直接開くと、ブラウザのセキュリティ制限
（file:// でのファイル読み込み禁止）によりデータを読み込めません。
必ずサーバー経由で開いてください。

  ローカル確認の例:
    フォルダ内で  python3 -m http.server
    → ブラウザで http://localhost:8000/books.html


【書影画像について】

Amazonの商品ページで書影を右クリック →「画像を保存」で
cover フォルダに「No..jpg」（例: 1.jpg）として保存してください。


【データの現状】

・Amazon URL: 99/100冊が商品ページ直リンク（/dp/...）
・No.95「意味よさらば」のみ別サイト（valuebooks）のURL
・No.78 は No.17 と同じ本（重複）
