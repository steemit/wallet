/* eslint-disable no-undef */
import { signData } from '@steemfans/auth-data';
import { api } from '@steemit/steem-js';

const request_base = {
    method: 'post',
    mode: 'no-cors',
    credentials: 'same-origin',
    headers: {
        Accept: 'application/json',
        'Content-type': 'application/json',
    },
};

export function serverApiLogin(account, signatures) {
    if (!process.env.BROWSER || window.$STM_ServerBusy) return;
    const request = Object.assign({}, request_base, {
        body: JSON.stringify({ account, signatures, csrf: $STM_csrf }),
    });
    return fetch('/api/v1/login_account', request);
}

export function serverApiLogout() {
    if (!process.env.BROWSER || window.$STM_ServerBusy) return;
    const request = Object.assign({}, request_base, {
        body: JSON.stringify({ csrf: $STM_csrf }),
    });
    return fetch('/api/v1/logout_account', request);
}

let last_call;
export function serverApiRecordEvent(type, val, rate_limit_ms = 5000) {
    return;
    // if (!process.env.BROWSER || window.$STM_ServerBusy) return;
    // if (last_call && new Date() - last_call < rate_limit_ms) return;
    // last_call = new Date();
    // const value = val && val.stack ? `${val.toString()} | ${val.stack}` : val;
    // api.call(
    //     'overseer.collect',
    //     { collection: 'event', metadata: { type, value } },
    //     error => {
    //         if (error) console.warn('overseer error', error, error.data);
    //     }
    // );
}

export function recordRouteTag(trackingId, tag, params, isLogin = false) {
    if (!process.env.BROWSER || window.$STM_ServerBusy) return;
    let tags = {
        app: 'wallet',
        tag,
    };
    let fields = {
        trackingId,
    };
    switch (tag) {
        case 'user_index':
            fields = {
                trackingId,
                permlink: params.accountname,
            };
            break;
    }
    tags['is_login'] = isLogin;
    api.call(
        'overseer.collect',
        [
            'custom',
            {
                measurement: 'route',
                fields,
                tags,
            },
        ],
        error => {
            if (error)
                console.warn('record route tag error', error, error.data);
        }
    );
}

export function userActionRecord(action, params) {
    if (!process.env.BROWSER || window.$STM_ServerBusy) return;
    const whaleThreshold = {
        steem: window.$STM_Config.steem_whale,
        sbd: window.$STM_Config.sbd_whale,
        trx: window.$STM_Config.trx_whale,
    };
    let tags = {
        app: 'wallet',
        action_type: action,
    };
    let fields = {};
    switch (action) {
        case 'transfer':
            tags = {
                app: 'wallet',
                action_type: action,
                transfer_coin: params.transferCoin,
                whale: (
                    params.amount > whaleThreshold[params.transferCoin]
                ).toString(),
            };
            fields = {
                from_username: params.from,
                to_username: params.to,
                amount: params.amount,
            };
            break;
        case 'change_password':
            fields = {
                username: params.username,
            };
            break;
        case 'recovery_account':
            fields = {
                username: params.username,
            };
            break;
        case 'withdraw_vesting':
            tags = {
                app: 'wallet',
                action_type: action,
                whale: (params.amount > whaleThreshold.steem).toString(),
            };
            fields = {
                username: params.username,
                amount: params.amount,
            };
            break;
        case 'cancel_withdraw_vesting':
            tags = {
                app: 'wallet',
                action_type: action,
            };
            fields = {
                username: params.username,
            };
            break;
        case 'cancel_transfer_from_savings':
            fields = {
                username: params.username,
            };
            break;
        case 'transfer_to_vesting':
            tags = {
                app: 'wallet',
                action_type: action,
                whale: (params.amount > whaleThreshold.steem).toString(),
            };
            fields = {
                from_username: params.from,
                to_username: params.to,
                amount: params.amount.split(' ')[0],
            };
            break;
        case 'transfer_to_savings':
            tags = {
                app: 'wallet',
                action_type: action,
                transfer_coin: params.transferCoin,
                whale: (
                    params.amount > whaleThreshold[params.transferCoin]
                ).toString(),
            };
            fields = {
                from_username: params.from,
                to_username: params.to,
                amount: params.amount,
            };
            break;
        case 'transfer_from_savings':
            tags = {
                app: 'wallet',
                action_type: action,
                transfer_coin: params.transferCoin,
                whale: (
                    params.amount > whaleThreshold[params.transferCoin]
                ).toString(),
            };
            fields = {
                from_username: params.from,
                to_username: params.to,
                amount: params.amount,
            };
            break;
        case 'delegate_vesting_shares':
            tags = {
                app: 'wallet',
                action_type: action,
                transfer_coin: params.transferCoin,
                whale: (
                    params.amount > whaleThreshold[params.transferCoin]
                ).toString(),
            };
            fields = {
                from_username: params.from,
                to_username: params.to,
                amount: params.amount,
            };
            break;
        case 'create_tron_addr':
        case 'change_new_tron_addr':
        case 'link_user_tron_addr':
            tags = {
                app: 'wallet',
                action_type: action,
            };
            fields = {
                username: params.username,
                tron_addr: params.tron_addr,
            };
            break;
        case 'account_witness_vote':
            fields = {
                username: params.username,
                witness: params.witness,
            };
            break;
        case 'account_witness_proxy':
            fields = {
                username: params.username,
                proxy: params.proxy,
            };
            break;
    }
    api.call(
        'overseer.collect',
        [
            'custom',
            {
                measurement: 'user_action',
                fields,
                tags,
            },
        ],
        error => {
            if (error)
                console.warn('user action record error', error, error.data);
        }
    );
}

export function recordAdsView({ trackingId, adTag }) {
    api.call('overseer.collect', ['ad', { trackingId, adTag }], error => {
        if (error) console.warn('overseer error', error);
    });
}

let last_page, last_views, last_page_promise;
export function recordPageView(page, referer, account) {
    return null; // TODO: disabled until overseer update
    // if (last_page_promise && page === last_page) return last_page_promise;

    // if (!process.env.BROWSER) return Promise.resolve(0);
    // if (window.ga) {
    //     // virtual pageview
    //     window.ga('set', 'page', page);
    //     window.ga('send', 'pageview');
    // }
    // last_page_promise = api.callAsync('overseer.pageview', {
    //     page,
    //     referer,
    //     account,
    // });
    // last_page = page;
    // return last_page_promise;
}

export function saveCords(x, y) {
    const request = Object.assign({}, request_base, {
        body: JSON.stringify({ csrf: $STM_csrf, x, y }),
    });
    fetch('/api/v1/save_cords', request);
}

export function setUserPreferences(payload) {
    if (!process.env.BROWSER || window.$STM_ServerBusy)
        return Promise.resolve();
    const request = Object.assign({}, request_base, {
        body: JSON.stringify({ csrf: window.$STM_csrf, payload }),
    });
    return fetch('/api/v1/setUserPreferences', request);
}

export function isTosAccepted() {
    // TODO: endpoint down. re-enable
    return true;
    // const request = Object.assign({}, request_base, {
    //     body: JSON.stringify({ csrf: window.$STM_csrf }),
    // });
    // return fetch('/api/v1/isTosAccepted', request).then(res => res.json());
}

export function acceptTos() {
    const request = Object.assign({}, request_base, {
        body: JSON.stringify({ csrf: window.$STM_csrf }),
    });
    return fetch('/api/v1/acceptTos', request);
}

export function checkTronUser(data, type = 'steem') {
    let queryString = '';
    if (type === 'steem') {
        queryString = `/api/v1/tron/tron_user?username=${data}`;
    } else {
        queryString = `/api/v1/tron/tron_user?tron_addr=${data}`;
    }
    return fetch(queryString)
        .then(res => {
            return res.json();
        })
        .then(res => {
            if (res.error) throw new Error(res.error);
            return res.result;
        });
}

/**
 * data required {
 *      username (required)
 *      auth_type
 *      tron_addr
 *      is_bind_exist_addr
 *      tip_count
 * }
 * privKey required
 */
export function updateTronUser(data, privKey) {
    const r = signData(data, privKey);
    const request = Object.assign({}, request_base, {
        body: JSON.stringify(r),
    });
    return fetch('/api/v1/tron/tron_user', request).then(res => {
        return res.json();
    });
}

export function createTronAccount() {
    const queryString = '/api/v1/tron/create_account';
    return fetch(queryString).then(res => {
        return res.json();
    });
}

export function getTronAccount(tron_address) {
    const queryString = '/api/v1/tron/get_account?tron_address=' + tron_address;
    return fetch(queryString).then(res => {
        return res.json();
    });
}

export function getTronConfig() {
    const queryString = '/api/v1/tron/get_config';
    return fetch(queryString);
}

export function claimPendingTrxReward(username) {
    const request = Object.assign({}, request_base, {
        body: JSON.stringify({ username }),
    });
    return fetch('/api/v1/tron/claim_pending_trx_reward', request).then(res => {
        return res.json();
    });
}
