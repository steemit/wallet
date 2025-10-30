import { api } from '@steemit/steem-js';
import { getRedirectPagePath } from './StateFunctions'
import stateCleaner from 'app/redux/stateCleaner';
import Witnesses from '../components/modules/Witnesses';

export async function getStateAsync(url) {
    // strip off query string
    const path = url.split('?')[0];
    let raw;
    if (path.match(/^\/(@[\w\.\d-]+)\/(witnesses)\/?$/)) {
        raw = await api.getStateAsync(path.replace('/witnesses', '/transfers'));
        let witnesses = await api.getStateAsync('/~witnesses');
        raw.witnesses = witnesses ? witnesses.witnesses : raw.witnesses
    } else {
        raw = await api.getStateAsync(path);
    }
    const cleansed = stateCleaner(raw);

    return cleansed;
}

export async function fetchData(method, params, id) {
    const requestData = {
        jsonrpc: '2.0',
        method,
        params,
        id,
    };

    const requestOptions = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData),
    };

    try {
        const url = api.options.url;
        const response = await fetch(url, requestOptions);
        const { result } = await response.json();
        return result
    } catch (error) {
        console.error('Error fetching data:', error);
        return {};
    }
}
