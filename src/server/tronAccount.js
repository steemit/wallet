// import config from 'config';
import { signData } from 'server/utils/encrypted';

const TronWeb = require('tronweb');
const CryptoJS = require('crypto-js');
// todo: fix import config cause compile fail bug every time

// const tronWeb = new TronWeb({
//     fullHost: config.get('tron_create_node'),
//     privateKey: config.get('tron_create_key'),
// });
const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey:
        'ade06c9d42d42c7e24bf93dcbb0a481193a6869400ddee21855d4cf585eaad8a',
});
// const userKey = config.get('tron_user_key');
const userKey = '5JPJJNot5TyFPDdBeKo2CWjkpLtGUAojMeewVaSxzfmbYJauutH';
export async function createAccount() {
    try {
        const obj = await tronWeb.createAccount();
        return obj;
    } catch (err) {
        console.log('error ');
        return err;
    }
}
export async function getTronAccount(trx_address) {
    try {
        const obj = await tronWeb.trx.getAccount(trx_address);
        return obj;
    } catch (err) {
        console.log('error ');
        return err;
    }
}

export function signTron(username, tron_address) {
    const data = {
        username,
        tron_addr: tron_address,
    };
    const r = signData(data, userKey);
    return r;
}

export function encryptedTronKey(key) {
    const ciphertext = CryptoJS.AES.encrypt(key, userKey).toString();
    return ciphertext;
}
export function validToken(token, key) {
    let bytes = CryptoJS.AES.decrypt(ciphertext, userKey);
    let originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText == key;
}

export function decryptedTronToken(token) {
    // Decrypt
    let bytes = CryptoJS.AES.decrypt(token, userKey);
    let originalText = bytes.toString(CryptoJS.enc.Utf8);
    return originalText;
}
