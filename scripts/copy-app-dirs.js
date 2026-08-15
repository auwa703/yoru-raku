// scripts/copy-app-dirs.js
//
// Netlifyのpublishディレクトリ(marketing/)へ admin/app/demo をコピーする。
// 元々は "cp -r admin app demo marketing/" というシェルコマンドだったが、
// クロスプラットフォームで動作確認できるようNode.jsに置き換えた。

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const targets = ['admin', 'app', 'demo'];

for (const dir of targets) {
  const src = path.join(root, dir);
  const dest = path.join(root, 'marketing', dir);
  fs.cpSync(src, dest, { recursive: true });
  console.log(`copied ${dir} -> marketing/${dir}`);
}
