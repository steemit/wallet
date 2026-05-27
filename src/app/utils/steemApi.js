import { api } from '@steemit/steem-js';
import { getRedirectPagePath } from './StateFunctions'
import stateCleaner from 'app/redux/stateCleaner';
import Witnesses from '../components/modules/Witnesses';

export async function getStateAsync(url) {
    try {
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
    } catch (error) {
        // Log error but don't throw - return empty state instead
        // This prevents 5xx errors when API calls fail
        console.error(
            JSON.stringify({
                msg: '~~ getStateAsync error ~~',
                url,
                error: error.message || error,
            })
        );

        // Return empty state structure to allow page to render
        // instead of showing 5xx error page
        // Ensure stateCleaner receives a valid structure
        const emptyState = {
            accounts: {},
            content: {},
        };
        try {
            return stateCleaner(emptyState);
        } catch (cleanerError) {
            // If stateCleaner fails, return the empty state directly
            console.error(
                JSON.stringify({
                    msg: '~~ stateCleaner error ~~',
                    error: cleanerError.message || cleanerError,
                })
            );
            return emptyState;
        }
    }
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
