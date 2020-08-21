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
    const koaBody = koa_body();

    router.get('/create_account', function*() {
        try {
            const obj = yield tronWeb.createAccount();
            this.body = JSON.stringify(obj);
        } catch (err) {
            console.log('error ');
            this.body = JSON.stringify({ error: err.message });
        }
    });
    router.get('/get_account', function*() {
        const q = this.request.query;
        if (!q) {
            this.body = JSON.stringify({ error: 'need_params' });
            return;
        }

        try {
            const obj = yield tronWeb.trx.getAccount(q.tron_address);
            this.body = JSON.stringify(obj);
        } catch (err) {
            console.log('error ');
            this.body = JSON.stringify({ error: err.message });
        }
    });
}
