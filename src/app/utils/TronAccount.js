const TronWeb = require('tronweb');
// const config = require('config');
const tronWeb = new TronWeb({
    fullHost: 'https://api.trongrid.io',
    privateKey:
        'ade06c9d42d42c7e24bf93dcbb0a481193a6869400ddee21855d4cf585eaad8a',
});

export async function createAccount() {
    try {
        const obj = await tronWeb.createAccount();
        return obj;
    } catch (err) {
        console.log('error ');
        return err;
    }
}
