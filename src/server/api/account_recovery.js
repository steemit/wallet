import koa_router from 'koa-router';
import koa_body from 'koa-body';
import models from 'db/models';
import config from 'config';
import { esc, escAttrs } from 'db/models';
import { getRemoteIp, rateLimitReq, checkCSRF } from 'server/utils/misc';
import { getCreatorInfo } from 'server/utils/recovery';
import { api, broadcast } from '@steemit/steem-js';

export default function useAccountRecoveryApi(app) {
    const router = koa_router();
    app.use(router.routes());
    const koaBody = koa_body();

    router.post('/initiate_account_recovery', koaBody, function*() {
        if (rateLimitReq(this, this.req)) return;
        let params = this.request.body;
        params = typeof params === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, params.csrf)) return;
        console.log(
            '-- /initiate_account_recovery -->',
            this.session.uid,
            params
        );
        this.session.recover_account = null;
        if (!params.account_name) {
            this.status = 500;
            this.body = 'please provide account name';
            return;
        }
        const attrs = { uid: this.session.uid, status: 'open', ...params };
        attrs.remote_ip = getRemoteIp(this.req);
        const request = yield models.AccountRecoveryRequest.create(
            escAttrs(attrs)
        );
        console.log(
            '-- /initiate_account_recovery request id -->',
            this.session.uid,
            request.id
        );
        this.session.arec = request.id;
        this.redirect('/connect/' + params.provider);
    });

    router.get('/account_recovery_confirmation/:code', function*() {
        if (rateLimitReq(this, this.req)) return;
        const code = this.params.code;
        if (!code) return this.throw('no confirmation code', 404);
        const arec = yield models.AccountRecoveryRequest.findOne({
            attributes: ['id', 'account_name', 'owner_key'],
            where: { validation_code: esc(code) },
            order: [['id', 'DESC']],
        });
        if (arec) {
            this.session.arec = arec.id;
            console.log(
                '-- /account_recovery_confirmation -->',
                this.session.uid,
                arec.id,
                arec.account_name,
                arec.owner_key
            );
            this.redirect('/recover_account_step_2');
        } else {
            console.log(
                '-- /account_recovery_confirmation code not found -->',
                this.session.uid,
                code
            );
            this.throw('wrong confirmation code', 404);
            this.session.arec = null;
        }
        this.body = code;
    });

    router.post('/api/v1/request_account_recovery', koaBody, function*() {
        if (rateLimitReq(this, this.req)) return;
        let params = this.request.body;
        params = typeof params === 'string' ? JSON.parse(params) : params;
        if (!checkCSRF(this, params.csrf)) return;
        try {
            if (!this.session.arec) {
                console.log(
                    '-- /request_account_recovery --> this.session.arec is empty',
                    this.session.uid
                );
                this.body = JSON.stringify({ error: 'Unauthorized' });
                this.status = 401;
                return;
            }

            const account_recovery_record = yield models.AccountRecoveryRequest.findOne(
                {
                    attributes: ['id', 'account_name', 'provider', 'status'],
                    where: { id: this.session.arec },
                }
            );

            if (
                !account_recovery_record ||
                account_recovery_record.account_name !== params.name
            ) {
                console.log(
                    '-- /request_account_recovery --> no arec found or wrong name',
                    this.session.uid,
                    params.name
                );
                this.body = JSON.stringify({ error: 'Unauthorized' });
                this.status = 401;
                return;
            }

            if (account_recovery_record.status !== 'confirmed') {
                console.log(
                    '-- /request_account_recovery --> no arec found or wrong name',
                    this.session.uid,
                    params.name
                );
                this.body = JSON.stringify({ error: 'Unauthorized' });
                this.status = 401;
                return;
            }

            const accounts = yield api.getAccountsAsync([params.name]);
            if (accounts.length !== 1) {
                console.log(
                    '-- /request_account_recovery --> no account found on chain',
                    this.session.uid,
                    params.name
                );
                this.body = JSON.stringify({ error: 'account_not_found' });
                this.status = 503;
                return;
            }
            const recovery_account_of_user = accounts[0].recovery_account;
            const all_recovery_accounts = getCreatorInfo();
            if (all_recovery_accounts === null) {
                console.log(
                    '-- /request_account_recovery --> not_config_recovery_accounts',
                    this.session.uid,
                    params.name
                );
                this.body = JSON.stringify({
                    error: 'server_side_error_receovery_accounts',
                });
                this.status = 503;
                return;
            }
            if (
                Object.keys(all_recovery_accounts).indexOf(
                    recovery_account_of_user
                ) === -1
            ) {
                console.log(
                    '-- /request_account_recovery --> not_find_available_recovery_account',
                    this.session.uid,
                    params.name
                );
                this.body = JSON.stringify({
                    error: 'not_find_available_recovery_account',
                });
                this.status = 503;
                return;
            }

            const {
                new_owner_authority,
                old_owner_key,
                new_owner_key,
            } = params;

            yield requestAccountRecovery({
                signing_key: all_recovery_accounts[recovery_account_of_user],
                account_to_recover: params.name,
                recovery_account: recovery_account_of_user,
                new_owner_authority,
            });
            console.log(
                '-- /request_account_recovery completed -->',
                this.session.uid,
                this.session.user,
                params.name,
                old_owner_key,
                new_owner_key
            );

            const attrs = {
                old_owner_key: esc(old_owner_key),
                new_owner_key: esc(new_owner_key),
                request_submitted_at: new Date(),
            };
            account_recovery_record.update(attrs);

            this.body = JSON.stringify({ status: 'ok' });
        } catch (error) {
            console.error(
                'Error in /request_account_recovery api call',
                this.session.uid,
                this.session.user,
                error.toString(),
                error.stack
            );
            this.body = JSON.stringify({ error: error.message });
            this.status = 500;
        }
    });

    router.post(
        '/api/v1/initiate_account_recovery_with_email',
        koaBody,
        function*() {
            const params = this.request.body;
            const { csrf, contact_email, account_name, owner_key } =
                typeof params === 'string' ? JSON.parse(params) : params;
            if (!checkCSRF(this, csrf)) return;
            console.log(
                '-- /initiate_account_recovery_with_email -->',
                this.session.uid,
                contact_email,
                account_name,
                owner_key
            );
            if (!account_name || !contact_email || !owner_key) {
                this.body = JSON.stringify({ status: 'error' });
                return;
            }
            const arec = yield models.AccountRecoveryRequest.findOne({
                attributes: ['id'],
                where: escAttrs({ account_name, contact_email }),
            });
            if (arec) {
                this.body = JSON.stringify({ status: 'duplicate' });
                return;
            }
            const attrs = {
                uid: this.session.uid,
                status: 'open',
                contact_email,
                account_name,
                owner_key,
                provider: 'email',
            };
            attrs.remote_ip = getRemoteIp(this.req);
            const request = yield models.AccountRecoveryRequest.create(
                escAttrs(attrs)
            );
            console.log(
                '-- initiate_account_recovery_with_email  -->',
                this.session.uid,
                request.id,
                account_name,
                owner_key
            );
            this.body = JSON.stringify({ status: 'ok' });
        }
    );
}

function* requestAccountRecovery({
    recovery_account,
    account_to_recover,
    new_owner_authority,
    signing_key,
}) {
    const operations = [
        [
            'request_account_recovery',
            {
                recovery_account,
                account_to_recover,
                new_owner_authority,
            },
        ],
    ];
    yield broadcast.sendAsync({ extensions: [], operations }, [signing_key]);
}
