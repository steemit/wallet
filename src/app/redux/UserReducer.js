import { fromJS } from 'immutable';
import { DEFAULT_LANGUAGE } from 'app/client_config';

// Action constants
const SHOW_LOGIN = 'user/SHOW_LOGIN';
const HIDE_LOGIN = 'user/HIDE_LOGIN';
const SHOW_TERMS = 'user/SHOW_TERMS';
export const ACCEPT_TERMS = 'user/ACCEPT_TERMS';
export const SAVE_LOGIN_CONFIRM = 'user/SAVE_LOGIN_CONFIRM';
export const SAVE_LOGIN = 'user/SAVE_LOGIN';
const REMOVE_HIGH_SECURITY_KEYS = 'user/REMOVE_HIGH_SECURITY_KEYS';
const CHANGE_LANGUAGE = 'user/CHANGE_LANGUAGE';
const SHOW_TRANSFER = 'user/SHOW_TRANSFER';
const HIDE_TRANSFER = 'user/HIDE_TRANSFER';
const SHOW_TRON_TRANSFER = 'user/SHOW_TRON_TRANSFER';
const HIDE_TRON_TRANSFER = 'user/HIDE_TRON_TRANSFER';
const SHOW_POWERDOWN = 'user/SHOW_POWERDOWN';
const HIDE_POWERDOWN = 'user/HIDE_POWERDOWN';
const SET_TRANSFER_DEFAULTS = 'user/SET_TRANSFER_DEFAULTS';
const CLEAR_TRANSFER_DEFAULTS = 'user/CLEAR_TRANSFER_DEFAULTS';
const SET_POWERDOWN_DEFAULTS = 'user/SET_POWERDOWN_DEFAULTS';
const CLEAR_POWERDOWN_DEFAULTS = 'user/CLEAR_POWERDOWN_DEFAULTS';
export const USERNAME_PASSWORD_LOGIN = 'user/USERNAME_PASSWORD_LOGIN';
export const SET_USERNAME = 'user/SET_USERNAME';
export const SET_USER = 'user/SET_USER';
const CLOSE_LOGIN = 'user/CLOSE_LOGIN';
export const LOGIN_ERROR = 'user/LOGIN_ERROR';
export const LOGOUT = 'user/LOGOUT';
const SET_LATEST_FEED_PRICE = 'user/SET_LATEST_FEED_PRICE';
const SHOW_SIGN_UP = 'user/SHOW_SIGN_UP';
const HIDE_SIGN_UP = 'user/HIDE_SIGN_UP';
const KEYS_ERROR = 'user/KEYS_ERROR';
const ACCOUNT_AUTH_LOOKUP = 'user/ACCOUNT_AUTH_LOOKUP';
const SET_AUTHORITY = 'user/SET_AUTHORITY';
const HIDE_CONNECTION_ERROR_MODAL = 'user/HIDE_CONNECTION_ERROR_MODAL';
const SET = 'user/SET';
const SHOW_SIDE_PANEL = 'user/SHOW_SIDE_PANEL';
const HIDE_SIDE_PANEL = 'user/HIDE_SIDE_PANEL';
const SHOW_VOTE = 'user/SHOW_VOTE';
const HIDE_VOTE = 'user/HIDE_VOTE';
const SHOW_TRON_UPDATE = 'user/SHOW_TRON_UPDATE';
const HIDE_TRON_UPDATE = 'user/HIDE_TRON_UPDATE';
const SHOW_TRON_UPDATE_SUCCESS = 'user/SHOW_TRON_UPDATE_SUCCESS';
const HIDE_TRON_UPDATE_SUCCESS = 'user/HIDE_TRON_UPDATE_SUCCESS';
const SHOW_TRON_CREATE = 'user/SHOW_TRON_CREATE';
export const HIDE_TRON_CREATE = 'user/HIDE_TRON_CREATE';
const SHOW_TRON_CREATE_SUCCESS = 'user/SHOW_TRON_CREATE_SUCCESS';
const HIDE_TRON_CREATE_SUCCESS = 'user/HIDE_TRON_CREATE_SUCCESS';
const SET_TRON_ACCOUNT_CHECK_ERROR = 'user/SET_TRON_ACCOUNT_CHECK_ERROR';
const SET_TO_TRON_ADDR = 'user/SET_TO_TRON_ADDR';
const SHOW_BIND_EXIST_TRON_ADDR = 'user/SHOW_BIND_EXIST_TRON_ADDR';
const HIDE_BIND_EXIST_TRON_ADDR = 'user/HIDE_BIND_EXIST_TRON_ADDR';
// Saga-related
export const LOAD_SAVINGS_WITHDRAW = 'user/LOAD_SAVINGS_WITHDRAW';
export const UPLOAD_IMAGE = 'user/UPLOAD_IMAGE';
export const GET_VESTING_DELEGATIONS = 'user/GET_VESTING_DELEGATIONS';
export const VESTING_DELEGATIONS_LOADING = 'user/VESTING_DELEGATIONS_LOADING';
export const SET_VESTING_DELEGATIONS = 'user/SET_VESTING_DELEGATIONS';
export const GET_EXPIRING_VESTING_DELEGATIONS = 'user/GET_EXPIRING_VESTING_DELEGATIONS';
export const SET_EXPIRING_VESTING_DELEGATIONS = 'user/SET_EXPIRING_VESTING_DELEGATIONS'
export const EXPIRING_VESTING_DELEGATIONS_LOADING = 'user/EXPIRING_VESTING_DELEGATIONS_LOADING'
export const CHECK_TRON = 'user/CHECK_TRON';
export const UPDATE_TRON_ADDR = 'user/UPDATE_TRON_ADDR';
export const RESET_ERROR = 'user/RESET_ERROR';
export const CLAIM_PENDING_TRX = 'user/CLAIM_PENDING_TRX';
export const LOAD_TRON_INFO_AGAIN = 'user/LOAD_TRON_INFO_AGAIN';

const defaultState = fromJS({
    current: null,
    show_login_modal: false,
    show_transfer_modal: false,
    show_signup_modal: false,
    show_post_advanced_settings_modal: '', // formId,
    show_vote_modal: false,
    show_tron_update_modal: false,
    show_tron_update_success_modal: false,
    show_tron_create_modal: false,
    show_tron_create_success_modal: false,
    pub_keys_used: null,
    locale: DEFAULT_LANGUAGE,
    show_side_panel: false,
    maybeLoggedIn: false,
    vestingDelegations: null,
    expiringVestingDelegations: null,
    tron_account_check_error: null,
    to_tron_addr: null,
    tron_balance: 0,
    show_bind_exist_tron_addr_modal: false,
});

export default function reducer(state = defaultState, action) {
    const payload = action.payload;

    switch (action.type) {
        case SHOW_LOGIN: {
            let operation, loginDefault;
            if (payload) {
                operation = fromJS(payload.operation);
                loginDefault = fromJS(payload.loginDefault);
            }
            return state.merge({
                show_login_modal: true,
                login_type: payload.type,
                loginBroadcastOperation: operation,
                loginDefault,
            });
        }

        case SET_LATEST_FEED_PRICE:
            return state.set('latest_feed_price', payload);

        case HIDE_LOGIN:
            return state.merge({
                show_login_modal: false,
                loginBroadcastOperation: undefined,
                loginDefault: undefined,
            });

        case SHOW_TERMS: {
            let termsDefault;
            if (payload) {
                termsDefault = fromJS(payload.termsDefault);
            }
            return state.merge({
                show_terms_modal: true,
                termsDefault,
            });
        }

        case ACCEPT_TERMS:
            return state.merge({
                show_terms_modal: false,
                termsDefault: undefined,
            });

        case SAVE_LOGIN_CONFIRM:
            return state.set('saveLoginConfirm', payload);

        case SAVE_LOGIN:
            // Use only for low security keys (like posting only keys)
            return state;

        case SET_VESTING_DELEGATIONS:
            return state.set('vestingDelegations', payload);

        case VESTING_DELEGATIONS_LOADING:
            return state.set('vestingDelegationsLoading', payload);

        case SET_EXPIRING_VESTING_DELEGATIONS:
            return state.set('expiringVestingDelegations', payload);

        case EXPIRING_VESTING_DELEGATIONS_LOADING:
            return state.set('expiringVestingDelegationsLoading', payload);

        case REMOVE_HIGH_SECURITY_KEYS: {
            if (!state.hasIn(['current', 'private_keys'])) return state;
            let empty = false;
            state = state.updateIn(
                ['current', 'private_keys'],
                private_keys => {
                    if (!private_keys) return null;
                    if (
                        private_keys.has('active_private') ||
                        private_keys.has('owner_private')
                    )
                        console.log('removeHighSecurityKeys');
                    private_keys = private_keys.delete('active_private');
                    private_keys = private_keys.delete('owner_private');
                    empty = private_keys.size === 0;
                    return private_keys;
                }
            );
            if (empty) {
                // LOGOUT
                return defaultState.merge({ logged_out: true });
            }
            const username = state.getIn(['current', 'username']);
            state = state.setIn(['authority', username, 'active'], 'none');
            state = state.setIn(['authority', username, 'owner'], 'none');
            return state;
        }

        case CHANGE_LANGUAGE:
            return state.set('locale', payload);

        case SHOW_TRANSFER:
            return state.set('show_transfer_modal', true);

        case HIDE_TRANSFER:
            return state.set('show_transfer_modal', false);

        case SHOW_TRON_TRANSFER:
            return state.set('show_tron_transfer_modal', true);

        case HIDE_TRON_TRANSFER:
            return state.set('show_tron_transfer_modal', false);

        case SHOW_POWERDOWN:
            return state.set('show_powerdown_modal', true);

        case HIDE_POWERDOWN:
            return state.set('show_powerdown_modal', false);

        case SET_TRANSFER_DEFAULTS:
            return state.set('transfer_defaults', fromJS(payload));

        case CLEAR_TRANSFER_DEFAULTS:
            return state.remove('transfer_defaults');

        case SET_POWERDOWN_DEFAULTS:
            return state.set('powerdown_defaults', fromJS(payload));

        case CLEAR_POWERDOWN_DEFAULTS:
            return state.remove('powerdown_defaults');

        case USERNAME_PASSWORD_LOGIN:
            return state; // saga

        case LOAD_SAVINGS_WITHDRAW:
            return state; // saga
        case CHECK_TRON:
            return state; // saga
        case UPDATE_TRON_ADDR:
            return state; // saga
        case SET_USER:
            if (payload.vesting_shares)
                payload.vesting_shares = parseFloat(payload.vesting_shares);
            if (payload.delegated_vesting_shares)
                payload.delegated_vesting_shares = parseFloat(
                    payload.delegated_vesting_shares
                );
            if (payload.received_vesting_shares)
                payload.received_vesting_shares = parseFloat(
                    payload.received_vesting_shares
                );
            return state.mergeDeep({
                current: payload,
                show_login_modal: false,
                show_vote_modal: false,
                loginBroadcastOperation: undefined,
                loginDefault: undefined,
                logged_out: undefined,
            });

        case CLOSE_LOGIN:
            return state.merge({
                login_error: undefined,
                show_login_modal: false,
                loginBroadcastOperation: undefined,
                loginDefault: undefined,
            });

        case LOGIN_ERROR:
            return state.merge({
                login_error: payload.error,
                logged_out: undefined,
            });

        case LOGOUT:
            return defaultState.merge({ logged_out: true });

        case SHOW_SIGN_UP:
            return state.set('show_signup_modal', true);

        case HIDE_SIGN_UP:
            return state.set('show_signup_modal', false);

        case KEYS_ERROR:
            return state.merge({ keys_error: payload.error });

        case ACCOUNT_AUTH_LOOKUP:
            // AuthSaga
            return state;

        case SET_AUTHORITY: {
            // AuthSaga
            const { accountName, auth, pub_keys_used } = payload;
            state = state.setIn(['authority', accountName], fromJS(auth));
            if (pub_keys_used)
                state = state.set('pub_keys_used', pub_keys_used);
            return state;
        }

        case HIDE_CONNECTION_ERROR_MODAL:
            return state.set('hide_connection_error_modal', true);

        case SET:
            return state.setIn(
                Array.isArray(payload.key) ? payload.key : [payload.key],
                fromJS(payload.value)
            );

        case SHOW_SIDE_PANEL:
            return state.set('show_side_panel', true);

        case HIDE_SIDE_PANEL:
            return state.set('show_side_panel', false);
        case SHOW_VOTE:
            return state.set('show_vote_modal', true);
        case HIDE_VOTE:
            return state.set('show_vote_modal', false);
        case SHOW_TRON_UPDATE:
            return state.set('show_tron_update_modal', true);
        case HIDE_TRON_UPDATE:
            return state.set('show_tron_update_modal', false);
        case SHOW_TRON_UPDATE_SUCCESS:
            return state.set('show_tron_update_success_modal', true);
        case HIDE_TRON_UPDATE_SUCCESS:
            return state.set('show_tron_update_success_modal', false);
        case SHOW_TRON_CREATE:
            return state.set('show_tron_create_modal', true);
        case HIDE_TRON_CREATE:
            return state.set('show_tron_create_modal', false);
        case SHOW_TRON_CREATE_SUCCESS:
            return state.set('show_tron_create_success_modal', true);
        case HIDE_TRON_CREATE_SUCCESS:
            return state.set('show_tron_create_success_modal', false);
        case SET_TRON_ACCOUNT_CHECK_ERROR:
            return state.set(
                'tron_account_check_error',
                payload ? payload : null
            );
        case SET_TO_TRON_ADDR:
            return state.set('to_tron_addr', payload ? payload : null);
        case CLAIM_PENDING_TRX:
            return state; // saga
        case SHOW_BIND_EXIST_TRON_ADDR:
            return state.set('show_bind_exist_tron_addr_modal', true);
        case HIDE_BIND_EXIST_TRON_ADDR:
            return state.set('show_bind_exist_tron_addr_modal', false);
        case LOAD_TRON_INFO_AGAIN:
            return state; // saga
        default:
            return state;
    }
}

// Action creators
export const showLogin = payload => ({
    type: SHOW_LOGIN,
    payload,
});

export const hideLogin = payload => ({
    type: HIDE_LOGIN,
    payload,
});

export const showVote = payload => ({
    type: SHOW_VOTE,
    payload,
});

export const hideVote = payload => ({
    type: HIDE_VOTE,
    payload,
});

export const showTronUpdate = payload => ({
    type: SHOW_TRON_UPDATE,
    payload,
});

export const hideTronUpdate = payload => ({
    type: HIDE_TRON_UPDATE,
    payload,
});

export const showTronUpdateSuccess = payload => ({
    type: SHOW_TRON_UPDATE_SUCCESS,
    payload,
});
export const hideTronUpdateSuccess = payload => ({
    type: HIDE_TRON_UPDATE_SUCCESS,
    payload,
});

export const showTronCreate = payload => ({
    type: SHOW_TRON_CREATE,
    payload,
});
export const hideTronCreate = payload => ({
    type: HIDE_TRON_CREATE,
    payload,
});

export const showTronCreateSuccess = payload => ({
    type: SHOW_TRON_CREATE_SUCCESS,
    payload,
});
export const hideTronCreateSuccess = payload => ({
    type: HIDE_TRON_CREATE_SUCCESS,
    payload,
});

export const showTerms = payload => ({
    type: SHOW_TERMS,
    payload,
});

export const acceptTerms = () => ({ type: ACCEPT_TERMS });

export const saveLoginConfirm = payload => ({
    type: SAVE_LOGIN_CONFIRM,
    payload,
});

export const saveLogin = payload => ({
    type: SAVE_LOGIN,
    payload,
});

export const removeHighSecurityKeys = payload => ({
    type: REMOVE_HIGH_SECURITY_KEYS,
    payload,
});

export const changeLanguage = payload => ({
    type: CHANGE_LANGUAGE,
    payload,
});

export const showTransfer = payload => ({
    type: SHOW_TRANSFER,
    payload,
});

export const hideTransfer = payload => ({
    type: HIDE_TRANSFER,
    payload,
});
export const showTronTransfer = payload => ({
    type: SHOW_TRON_TRANSFER,
    payload,
});

export const hideTronTransfer = payload => ({
    type: HIDE_TRON_TRANSFER,
    payload,
});

export const showPowerdown = payload => ({
    type: SHOW_POWERDOWN,
    payload,
});

export const hidePowerdown = payload => ({
    type: HIDE_POWERDOWN,
    payload,
});

export const setTransferDefaults = payload => ({
    type: SET_TRANSFER_DEFAULTS,
    payload,
});

export const clearTransferDefaults = payload => ({
    type: CLEAR_TRANSFER_DEFAULTS,
    payload,
});

export const setPowerdownDefaults = payload => ({
    type: SET_POWERDOWN_DEFAULTS,
    payload,
});

export const clearPowerdownDefaults = payload => ({
    type: CLEAR_POWERDOWN_DEFAULTS,
    payload,
});

export const usernamePasswordLogin = payload => ({
    type: USERNAME_PASSWORD_LOGIN,
    payload,
});

export const setUser = payload => ({
    type: SET_USER,
    payload,
});

export const closeLogin = payload => ({
    type: CLOSE_LOGIN,
    payload,
});

export const loginError = payload => ({
    type: LOGIN_ERROR,
    payload,
});

export const logout = payload => ({
    type: LOGOUT,
    payload,
});

export const showSignUp = payload => ({
    type: SHOW_SIGN_UP,
    payload,
});

export const hideSignUp = payload => ({
    type: HIDE_SIGN_UP,
    payload,
});

export const keysError = payload => ({
    type: KEYS_ERROR,
    payload,
});

export const accountAuthLookup = payload => ({
    type: ACCOUNT_AUTH_LOOKUP,
    payload,
});

export const setAuthority = payload => ({
    type: SET_AUTHORITY,
    payload,
});

export const setLatestFeedPrice = payload => ({
    type: SET_LATEST_FEED_PRICE,
    payload,
});

export const hideConnectionErrorModal = payload => ({
    type: HIDE_CONNECTION_ERROR_MODAL,
    payload,
});

export const set = payload => ({
    type: SET,
    payload,
});

export const loadSavingsWithdraw = payload => ({
    type: LOAD_SAVINGS_WITHDRAW,
    payload,
});

export const checkTron = payload => ({
    type: CHECK_TRON,
    payload,
});

export const updateTronAddr = payload => ({
    type: UPDATE_TRON_ADDR,
    payload,
});

export const showSidePanel = () => ({
    type: SHOW_SIDE_PANEL,
});

export const hideSidePanel = () => {
    return {
        type: HIDE_SIDE_PANEL,
    };
};

/* Outing */

export const getVestingDelegations = (payload) => {
    return {
        type: GET_VESTING_DELEGATIONS,
        payload,
    };
};

export const setVestingDelegations = (payload) => ({
    type: SET_VESTING_DELEGATIONS,
    payload,
});

export const vestingDelegationsLoading = (payload) => ({
    type: VESTING_DELEGATIONS_LOADING,
    payload,
});

/* Expiring */

export const getExpiringVestingDelegations = (payload) => {
    return {
        type: GET_EXPIRING_VESTING_DELEGATIONS,
        payload,
    };
};

export const setExpiringVestingDelegations = (payload) => ({
    type: SET_EXPIRING_VESTING_DELEGATIONS,
    payload,
});

export const expiringVestingDelegationsLoading = (payload) => ({
    type: EXPIRING_VESTING_DELEGATIONS_LOADING,
    payload,
});

export const setTronAccountCheckError = payload => ({
    type: SET_TRON_ACCOUNT_CHECK_ERROR,
    payload,
});

export const setToTronAddr = payload => ({
    type: SET_TO_TRON_ADDR,
    payload,
});

export const claimPendingTrx = payload => ({
    type: CLAIM_PENDING_TRX,
    payload,
});

export const showBindExistTronAddr = payload => ({
    type: SHOW_BIND_EXIST_TRON_ADDR,
    payload,
});

export const hideBindExistTronAddr = payload => ({
    type: HIDE_BIND_EXIST_TRON_ADDR,
    payload,
});

export const loadTronInfoAgain = payload => ({
    type: LOAD_TRON_INFO_AGAIN,
    payload,
});
