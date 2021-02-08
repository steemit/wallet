/* eslint-disable no-restricted-syntax */
import { fromJS } from 'immutable';
import { call, put, select, takeEvery, takeLatest } from 'redux-saga/effects';
import tt from 'counterpart';
import { api } from '@steemit/steem-js';
import {
    setUserPreferences,
    checkTronUser,
    recordRouteTag,
} from 'app/utils/ServerApiClient';
import { getStateAsync } from 'app/utils/steemApi';
import { getTronAccount } from 'app/utils/tronApi';
import * as globalActions from './GlobalReducer';
import * as appActions from './AppReducer';
import * as transactionActions from './TransactionReducer';

const wait = ms =>
    new Promise(resolve => {
        setTimeout(() => resolve(), ms);
    });

export const sharedWatches = [
    takeEvery(globalActions.GET_STATE, getState),
    takeEvery(appActions.ROUTE_TAG_SET, triggeRecordRouteTag),
    takeLatest(
        [appActions.SET_USER_PREFERENCES, appActions.TOGGLE_NIGHTMODE],
        saveUserPreferences
    ),
    takeEvery('transaction/ERROR', showTransactionErrorNotification),
];

export function* getAccount(username, force = false) {
    let account = yield select(state =>
        state.global.get('accounts').get(username)
    );

    // hive never serves `owner` prop (among others)
    const isLite = !!account && !account.get('owner');

    if (!account || force || isLite) {
        console.log(
            'getAccount: loading',
            username,
            'force?',
            force,
            'lite?',
            isLite
        );

        [account] = yield call([api, api.getAccountsAsync], [username]);
        if (account) {
            // get tron information by steem username
            // and merge into account
            let tronAccount = fromJS(yield call(checkTronUser, username));

            // get tron balance and merge into account
            tronAccount = tronAccount.mergeDeep(fromJS({ tron_balance: 0 }));
            if (tronAccount.get('tron_addr')) {
                const tronNetworkAccount = yield call(
                    getTronAccount,
                    tronAccount.get('tron_addr')
                );
                if (
                    Object.keys(tronNetworkAccount).length > 0 &&
                    tronNetworkAccount.balance !== undefined
                ) {
                    tronAccount = tronAccount.mergeDeep(
                        fromJS({
                            tron_balance: tronNetworkAccount.balance / 1e6,
                        })
                    );
                }
            }
            // merge and update account
            account = fromJS(account).mergeDeep(tronAccount);
            yield put(globalActions.receiveAccount({ account }));
        }
    }
    return account;
}

/** Manual refreshes.  The router is in FetchDataSaga. */
export function* getState({ payload: { url } }) {
    try {
        const state = yield call(getStateAsync, url);
        yield put(globalActions.receiveState(state));
    } catch (error) {
        console.error('~~ Saga getState error ~~>', url, error);
        yield put(appActions.steemApiError(error.message));
    }
}

function* showTransactionErrorNotification() {
    const errors = yield select(state => state.transaction.get('errors'));
    for (const [key, message] of errors) {
        // Do not display a notification for the bandwidthError key.
        if (key !== 'bandwidthError') {
            yield put(appActions.addNotification({ key, message }));
            yield put(transactionActions.deleteError({ key }));
        }
    }
}

/**
 * Save this user's preferences, either directly from the submitted payload or from whatever's saved in the store currently.
 *
 * @param {Object?} params.payload
 */
function* saveUserPreferences({ payload }) {
    console.log('saveUserPreferences', payload);
    if (payload) {
        yield setUserPreferences(payload);
        return;
    }

    const prefs = yield select(state => state.app.get('user_preferences'));
    console.log('saveUserPreferences prefs', prefs);
    yield setUserPreferences(prefs.toJS());
}

function* triggeRecordRouteTag({ routeTag, params }) {
    const [trackingId, username] = yield select(state => [
        state.app.getIn(['trackingId'], null),
        state.user.getIn(['current', 'username'], null),
    ]);
    yield recordRouteTag(trackingId, routeTag, params, username !== null);
}
