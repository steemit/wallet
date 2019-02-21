import * as config from 'config';
import axios from 'axios';
import NodeCache from 'node-cache';

export function Currencies() {
    const cache = new NodeCache({
        stdTTL: config.currency_cache.ttl,
    });

    const key = config.currency_cache.key;
    cache.on('expired', (k, v) => {
        console.log('Cache key expired', k);
        if (key === k) {
            this.promise = this.refresh();
        }
    });

    this.cache = cache;
    this.promise = this.refresh();
}

Currencies.prototype.get = async function() {
    await this.promise;

    const key = config.currency_cache.key;
    return new Promise((res, rej) => {
        this.cache.get(key, (err, value) => {
            if (err) {
                console.error('Could not retrieve currencies');
            }

            res(value);
        });
    });
};

Currencies.prototype.refresh = function() {
    console.info('Refreshing currencies...');

    const currencies = config.currency_cache.currencies;
    const key = config.currency_cache.key;
    const url = config.coinmarketcap.url;
    const path = config.coinmarketcap.currency_path;
    const token = config.coinmarketcap.token;
    return new Promise((res, rej) => {
        const search = `symbol=${currencies.join(',')}`;
        const options = {
            url: `${url}${path}?${search}`,
            method: 'GET',
            headers: {
                'X-CMC_PRO_API_KEY': token,
            },
        };

        axios(options)
            .then(response => {
                this.cache.set(key, response.data.data, (err, success) => {
                    if (err) {
                        console.error('Error storing currencies in cache', err);
                    }

                    console.info('Currencies refreshed...');
                    res();
                });
            })
            .catch(err => {
                console.error('Could not fetch currency list', err);
                this.cache.set(key, response.data.data, (err, success) => {
                    if (err) {
                        console.error('Error storing currencies in cache', err);
                    }
                    console.info('Currencies refreshed...');
                    res();
                });
            });
    });
};
