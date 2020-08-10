/* eslint-disable arrow-parens */
/* eslint-disable no-underscore-dangle */
import { getRemoteIp } from 'server/utils/misc';

const _stringval = v => (typeof v === 'string' ? v : JSON.stringify(v));
function logRequest(path, ctx, extra) {
    const d = { ip: getRemoteIp(ctx.req) };
    if (ctx.session) {
        if (ctx.session.user) {
            d.user = ctx.session.user;
        }
        if (ctx.session.uid) {
            d.uid = ctx.session.uid;
        }
        if (ctx.session.a) {
            d.account = ctx.session.a;
        }
    }
    if (extra) {
        Object.keys(extra).forEach(k => {
            const nk = d[k] ? '_' + k : k;
            d[nk] = extra[k];
        });
    }
    const info = Object.keys(d)
        .map(k => `${k}=${_stringval(d[k])}`)
        .join(' ');
    console.log(`-- /${path} --> ${info}`);
}

module.exports = {
    logRequest,
};
