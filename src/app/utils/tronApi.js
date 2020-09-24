/* eslint-disable import/prefer-default-export */
import TronWeb from 'tronweb';

export async function getTronAccount(addr) {
    const apiTronHost = global.$STM_Config
        ? global.$STM_Config.tron_host
        : 'https://api.shasta.trongrid.io';
    const tronWeb = new TronWeb({
        fullHost: apiTronHost,
    });
    return await tronWeb.trx.getAccount(addr);
}
