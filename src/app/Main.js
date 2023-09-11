import 'babel-core/register';
import 'babel-polyfill';
import 'whatwg-fetch';
import store from 'store';
import { VIEW_MODE_WHISTLE, PARAM_VIEW_MODE } from 'shared/constants';
import './assets/stylesheets/app.scss';
// import plugins from 'app/utils/JsPlugins';
import Iso from 'iso';
import { clientRender } from 'shared/UniversalRender';
import ConsoleExports from './utils/ConsoleExports';
// import { serverApiRecordEvent } from 'app/utils/ServerApiClient';
import * as steem from '@steemit/steem-js';
import { determineViewMode } from 'app/utils/Links';
import frontendLogger from 'app/utils/FrontendLogger';

window.addEventListener('error', frontendLogger);

const CMD_LOG_T = 'log-t';
const CMD_LOG_TOGGLE = 'log-toggle';
const CMD_LOG_O = 'log-on';

try {
    if (process.env.NODE_ENV === 'development') {
        // Adds some object refs to the global window object
        ConsoleExports.init(window);
    }
} catch (e) {
    console.error(e);
}

function runApp(initial_state) {
    console.log('Initial state', initial_state);

    const config = initial_state.offchain.config;

    const steemSelectedRpc = localStorage.getItem('steemSelectedRpc');

    if (!steemSelectedRpc) {
        localStorage.setItem(
            'steemSelectedRpc',
            config.steemd_connection_client
        );
    }

    steem.api.setOptions({
        url: steemSelectedRpc || config.steemd_connection_client,
        retry: true,
        useAppbaseApi: !!config.steemd_use_appbase,
    });
    steem.config.set('address_prefix', config.address_prefix);
    steem.config.set('chain_id', config.chain_id);
    window.$STM_Config = config;
    // plugins(config);
    if (initial_state.offchain.serverBusy) {
        window.$STM_ServerBusy = true;
    }
    if (initial_state.offchain.csrf) {
        window.$STM_csrf = initial_state.offchain.csrf;
        delete initial_state.offchain.csrf;
    }

    initial_state.app.viewMode = determineViewMode(window.location.search);

    const locale = store.get('language');
    if (locale) initial_state.user.locale = locale;
    initial_state.user.maybeLoggedIn =
        store.get('autopost2') || sessionStorage.getItem('username');
    if (initial_state.user.maybeLoggedIn) {
        const username = new Buffer(store.get('autopost2'), 'hex')
            .toString()
            .split('\t')[0];
        initial_state.user.current = {
            username,
        };
    }

    const location = `${window.location.pathname}${window.location.search}${
        window.location.hash
    }`;

    try {
        clientRender(initial_state);
    } catch (error) {
        console.error(error);
        // serverApiRecordEvent('client_error', error);
    }
}

if (!window.Intl) {
    require.ensure(
        ['intl/dist/Intl'],
        require => {
            window.IntlPolyfill = window.Intl = require('intl/dist/Intl');
            require('intl/locale-data/jsonp/en-US.js');
            require('intl/locale-data/jsonp/es.js');
            require('intl/locale-data/jsonp/ru.js');
            require('intl/locale-data/jsonp/fr.js');
            require('intl/locale-data/jsonp/it.js');
            require('intl/locale-data/jsonp/ko.js');
            require('intl/locale-data/jsonp/ja.js');
            Iso.bootstrap(runApp);
        },
        'IntlBundle'
    );
} else {
    Iso.bootstrap(runApp);
}
