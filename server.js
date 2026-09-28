// 备用本地服务器（当 python 不可用时由 bat 调用）
const http = require('http'), fs = require('fs'), path = require('path');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.json':'application/json'};
const port = parseInt(process.argv[2] || '8899', 10);
http.createServer((req, res) => {
  let p = decodeURIComponent((req.url || '/').split('?')[0]);
  if (p === '/') p = '/yibo.html';
  const fp = path.join(process.cwd(), p);
  if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
    res.writeHead(200, {'Content-Type': types[path.extname(fp)] || 'application/octet-stream'});
    fs.createReadStream(fp).pipe(res);
  } else { res.writeHead(404); res.end('404 Not Found'); }
}).listen(port, '127.0.0.1', () => console.log('Serving on http://localhost:' + port));
