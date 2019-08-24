import { fromJS, Map } from 'immutable';

// Action constants
const SET_COMMUNITY_TITLE = 'community/SET_COMMUNITY_TITLE';
const SET_COMMUNITY_DESCRIPTION = 'community/SET_COMMUNITY_DESCRIPTION';
const SET_COMMUNITY_NSFW = 'community/SET_COMMUNITY_NSFW';

const SET_COMMUNITY_OWNER_ACCOUNT_NAME =
    'community/SET_COMMUNITY_OWNER_ACCOUNT_NAME';
const SET_COMMUNITY_OWNER_MASTER_PASSWORD =
    'community/SET_COMMUNITY_OWNER_MASTER_PASSWORD';

export const CREATE_COMMUNITY_ACCOUNT = 'community/CREATE_COMMUNITY_ACCOUNT'; // Has saga.
const CREATE_COMMUNITY_ACCOUNT_PENDING =
    'community/CREATE_COMMUNITY_ACCOUNT_PENDING';
const CREATE_COMMUNITY_ACCOUNT_ERROR =
    'community/CREATE_COMMUNITY_ACCOUNT_ERROR';

const COMMUNITY_HIVEMIND_OPERATION = 'community/COMMUNITY_HIVEMIND_OPERATION'; // Has saga.
const COMMUNITY_HIVEMIND_OPERATION_PENDING =
    'community/COMMUNITY_HIVEMIND_OPERATION_PENDING';
const COMMUNITY_HIVEMIND_OPERATION_ERROR =
    'community/COMMUNITY_HIVEMIND_OPERATION_ERROR';

// Saga-related
const defaultState = fromJS({
    communityTitle: '',
    communityDescription: '',
    communityNSFW: false,
    communityOwnerName: '',
    communityOwnerMasterPassword: '',
    communityCreatePending: false,
    communityCreateError: false,
    communityHivemindOperationPending: false,
    communityHivemindOperationError: false,
});

export default function reducer(state = defaultState, action) {
    const payload = action.payload;
    switch (action.type) {
        case SET_COMMUNITY_TITLE: {
            const title = fromJS(payload);
            return state.merge({ communityTitle: title });
        }
        case SET_COMMUNITY_DESCRIPTION: {
            const description = fromJS(payload);
            return state.merge({ communityDescription: description });
        }
        case SET_COMMUNITY_NSFW: {
            const nsfw = fromJS(payload);
            return state.merge({ communityNSFW: nsfw });
        }
        case SET_COMMUNITY_OWNER_ACCOUNT_NAME: {
            const name = fromJS(payload);
            return state.merge({ communityOwnerName: name });
        }
        case SET_COMMUNITY_OWNER_MASTER_PASSWORD: {
            const password = fromJS(payload);
            return state.merge({ communityOwnerMasterPassword: password });
        }
        // Has a saga watcher.
        case CREATE_COMMUNITY_ACCOUNT: {
            return state;
        }

        case CREATE_COMMUNITY_ACCOUNT_PENDING: {
            const pending = fromJS(payload);
            return state.merge({ communityCreatePending: pending });
        }
        case CREATE_COMMUNITY_ACCOUNT_ERROR: {
            const err = fromJS(payload);
            return state.merge({ communityCreateError: err });
        }
        // Has a saga watcher.
        case COMMUNITY_HIVEMIND_OPERATION: {
            return state;
        }
        case COMMUNITY_HIVEMIND_OPERATION_PENDING: {
            const pending = fromJS(payload);
            return state.merge({ communityHivemindOperationPending: pending });
        }
        case COMMUNITY_HIVEMIND_OPERATION_ERROR: {
            const err = fromJS(payload);
            return state.merge({ communityHivemindOperationError: err });
        }
        default:
            return state;
    }
}

// Action creators
export const setCommunityTitle = payload => ({
    type: SET_COMMUNITY_TITLE,
    payload,
});

export const setCommunityDescription = payload => ({
    type: SET_COMMUNITY_DESCRIPTION,
    payload,
});
export const setCommunityNSFW = payload => ({
    type: SET_COMMUNITY_NSFW,
    payload,
});

export const setCommunityOwnerAccountName = payload => ({
    type: SET_COMMUNITY_OWNER_ACCOUNT_NAME,
    payload,
});
export const setCommunityOwnerMasterPassword = payload => ({
    type: SET_COMMUNITY_OWNER_MASTER_PASSWORD,
    payload,
});
export const createCommunityAccount = payload => ({
    type: CREATE_COMMUNITY_ACCOUNT,
    payload,
});

export const createCommunityAccountPending = payload => ({
    type: CREATE_COMMUNITY_ACCOUNT_PENDING,
    payload,
});
export const createCommunityAccountError = payload => ({
    type: CREATE_COMMUNITY_ACCOUNT_ERROR,
    payload,
});
export const communityHivemindOperation = payload => ({
    type: COMMUNITY_HIVEMIND_OPERATION,
    payload,
});
export const communityHivemindOperationPending = payload => ({
    type: COMMUNITY_HIVEMIND_OPERATION_PENDING,
    payload,
});
export const communityHivemindOperationError = payload => ({
    type: COMMUNITY_HIVEMIND_OPERATION_ERROR,
    payload,
});
