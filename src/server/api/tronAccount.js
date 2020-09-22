import koa_router from 'koa-router';
import koa_body from 'koa-body';
import config from 'config';

const TronWeb = require('tronweb');

const tronWeb = new TronWeb({
    fullHost: config.get('tron_create_node'),
    privateKey: config.get('tron_create_key'),
});

export default function tronAccount(app) {
    const router = koa_router({ prefix: '/api/v1/tron' });
    app.use(router.routes());
    // const koaBody = koa_body();
    // const regex = new RegExp(/^((1?\d?\d|2[0-4]\d|25[0-5])($|\.(?!$))){4}$/)
    const white_list = config.get('white_list');
    router.get('/create_account', function*() {
        const host = this.host.split(':')[0];
        if (!white_list.includes(host)) {
            this.body = JSON.stringify({
                ip: this.request.ip,
                host,
                msg:
                    'not trusted host reject value' + white_list.includes(host),
            });
            return;
        }
        try {
            const obj = yield tronWeb.createAccount();
            this.body = JSON.stringify(obj);
        } catch (err) {
            console.log('error ' + JSON.stringify(err));
            this.body = JSON.stringify({ error: JSON.stringify(err) });
        }
    });
    router.get('/get_account', function*() {
        const host = this.host.split(':')[0];
        if (!white_list.includes(host)) {
            this.body = JSON.stringify({
                ip: this.request.ip,
                host,
                msg:
                    'not trusted host reject value' +
                    white_list.includes(host) +
                    '  ' +
                    white_list,
            });
            return;
        }
        const q = this.request.query;
        if (!q) {
            this.body = JSON.stringify({ error: 'need_params' });
            return;
        }

        try {
            const obj = yield tronWeb.trx.getAccount(q.tron_address);
            this.body = JSON.stringify(obj);
        } catch (err) {
            console.log('error ' + JSON.stringify(err));
            this.body = JSON.stringify({ error: JSON.stringify(err) });
        }
    });
}
