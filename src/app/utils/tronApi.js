/* eslint-disable import/prefer-default-export */
import { api } from '@steemit/steem-js';
import { PrivateKey as SteemPrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import { updateTronUser } from 'app/utils/ServerApiClient';
import TronWeb from 'tronweb';
import { api } from '@steemit/steem-js';
import { PrivateKey as SteemPrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import { updateTronUser } from 'app/utils/ServerApiClient';

export async function createTronAccount() {
    const apiTronHost = global.$STM_Config
        ? global.$STM_Config.tron_host
        : 'https://api.shasta.trongrid.io';
    const tronWeb = new TronWeb({
        fullHost: apiTronHost,
    });
    try {
        return await tronWeb.createAccount();
    } catch (err) {
        console.error('create tron account error:' + err);
        return null;
    }
}

export async function getTronAccount(addr) {
    const apiTronHost = global.$STM_Config
        ? global.$STM_Config.tron_host
        : 'https://api.shasta.trongrid.io';
    const tronWeb = new TronWeb({
        fullHost: apiTronHost,
    });
    return await tronWeb.trx.getAccount(addr);
}

export async function transferTrxTo(from, to, amount, memo, privateKey) {
    const apiTronHost = global.$STM_Config
        ? global.$STM_Config.tron_host
        : 'https://api.shasta.trongrid.io';
    const tronWeb = new TronWeb({
        fullHost: apiTronHost,
    });
    const sumAmount = parseInt(amount * 1e6, 10);
    // build tx
    let tx = await tronWeb.transactionBuilder.sendTrx(to, sumAmount, from);
    if (memo) {
        // write memo
        tx = await tronWeb.transactionBuilder.addUpdateData(tx, memo, 'utf8');
    }
    // sign
    const signedTx = await tronWeb.trx.sign(tx, privateKey);
    // broadcast
    const trxResult = await tronWeb.trx.sendRawTransaction(signedTx);
    return trxResult;
}

export function isTronAddr(addr) {
    const apiTronHost = global.$STM_Config
        ? global.$STM_Config.tron_host
        : 'https://api.shasta.trongrid.io';
    const tronWeb = new TronWeb({
        fullHost: apiTronHost,
    });
    return tronWeb.isAddress(addr);
}

export async function updateCustomTronAddr(username, password, tronAddr) {
    const users = await api.getAccountsAsync([username]);
    // console.log('debug:users:', users);
    if (users.length === 0) {
        return {
            status: false,
            err: 'g.username_does_not_exist',
        };
    }
    // get owner and active publi keys
    const pubKeys = {};
    ['owner', 'active'].forEach(authType =>
        users[0][authType].key_auths.forEach(
            (v, i) => (pubKeys[users[0][authType].key_auths[i][0]] = authType)
        )
    );
    // console.log('debug:pubKeys:', pubKeys);

    // parse password
    let privateKey;
    let publicKey;
    try {
        privateKey = SteemPrivateKey.fromWif(password);
        publicKey = privateKey.toPublicKey().toString();
    } catch (e) {
        // master password
        privateKey = SteemPrivateKey.fromSeed(username + 'active' + password);
    }
    publicKey = privateKey.toPublicKey().toString();
    // console.log('debug:pub/priv:', privateKey, publicKey);

    // get authType
    const inx = Object.keys(pubKeys).indexOf(publicKey);
    // console.log('debug:inx:', inx, Object.keys(pubKeys));
    if (inx === -1) {
        return {
            status: false,
            err: 'g.this_is_wrong_password',
        };
    }
    const authType = pubKeys[Object.keys(pubKeys)[inx]];
    // console.log('debug:authType:', authType);

    // update steem user's tron_addr
    const data = {
        username,
        auth_type: authType,
        tron_addr: tronAddr,
        is_bind_exist_addr: true,
    };
    const result = await updateTronUser(data, privateKey.toWif());
    // console.log('debug:send:', data, result);
    if (result.error !== undefined) {
        console.error('tron_err_msg:', result.error);
        return {
            status: false,
            err: `tron_err_msg.${result.error}`,
        };
    }
    return {
        status: true,
    };
}
