import { fromJS } from 'immutable';

// Action constants
const SET_COMMUNITY_TITLE = 'community/SET_COMMUNITY_TITLE';
const SET_COMMUNITY_DESCRIPTION = 'community/SET_COMMUNITY_DESCRIPTION';
const SET_COMMUNITY_NSFW = 'community/SET_COMMUNITY_NSFW';

const SET_COMMUNITY_OWNER_ACCOUNT_NAME =
    'community/SET_COMMUNITY_OWNER_ACCOUNT_NAME';
const SET_COMMUNITY_OWNER_WIF_PASSWORD =
    'community/SET_COMMUNITY_OWNER_MASTER_PASSWORD';
export const SET_COMMUNITY_ACCOUNT_CREATED =
    'community/SET_COMMUNITY_ACCOUNT_CREATED';

export const CREATE_COMMUNITY_ACCOUNT = 'community/CREATE_COMMUNITY_ACCOUNT'; // Has saga.
export const CREATE_COMMUNITY_ACCOUNT_PENDING =
    'community/CREATE_COMMUNITY_ACCOUNT_PENDING';
export const CREATE_COMMUNITY_ACCOUNT_ERROR =
    'community/CREATE_COMMUNITY_ACCOUNT_ERROR';
export const CREATE_COMMUNITY_SUCCESS = 'community/CREATE_COMMUNITY_SUCCESS';
export const COMMUNITY_HIVEMIND_OPERATION =
    'community/COMMUNITY_HIVEMIND_OPERATION'; // Has saga.
export const COMMUNITY_HIVEMIND_OPERATION_PENDING =
    'community/COMMUNITY_HIVEMIND_OPERATION_PENDING';
export const COMMUNITY_HIVEMIND_OPERATION_ERROR =
    'community/COMMUNITY_HIVEMIND_OPERATION_ERROR';

// Saga-related
const defaultState = fromJS({
    communityTitle: '',
    communityDescription: '',
    communityNSFW: false,
    communityOwnerName: '',
    communityOwnerWifPassword: '',
    communityCreatePending: false,
    communityCreateSuccess: false,
    communityHivemindOperationPending: false,
    communityHivemindOperationError: false,
    communityAccountCreated: false,
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
        case SET_COMMUNITY_OWNER_WIF_PASSWORD: {
            const password = fromJS(payload);
            return state.merge({ communityOwnerWifPassword: password });
        }
        case SET_COMMUNITY_ACCOUNT_CREATED: {
            const creationSuccess = fromJS(payload);
            return state.merge({ communityAccountCreated: creationSuccess });
        }
        // Has a saga watcher.
        case CREATE_COMMUNITY_ACCOUNT: {
            return state;
        }
        // Has a saga watcher.
        case CREATE_COMMUNITY_ACCOUNT_ERROR: {
            return state;
        }
        case CREATE_COMMUNITY_ACCOUNT_PENDING: {
            const pending = fromJS(payload);
            return state.merge({ communityCreatePending: pending });
        }
        case CREATE_COMMUNITY_SUCCESS: {
            const success = fromJS(payload);
            return state.merge({ communityCreateSuccess: success });
        }
        // Has a saga watcher.
        case COMMUNITY_HIVEMIND_OPERATION: {
            return state;
        }
        case COMMUNITY_HIVEMIND_OPERATION_PENDING: {
            const pending = fromJS(payload);
            return state.merge({
                communityHivemindOperationPending: pending,
            });
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

export const setCommunityAccountCreated = payload => ({
    type: SET_COMMUNITY_ACCOUNT_CREATED,
    payload,
});

export const setCommunityOwnerAccountName = payload => ({
    type: SET_COMMUNITY_OWNER_ACCOUNT_NAME,
    payload,
});
export const setCommunityOwnerWifPassword = payload => ({
    type: SET_COMMUNITY_OWNER_WIF_PASSWORD,
    payload,
});
// Has a saga.
export const createCommunity = payload => {
    return {
        type: CREATE_COMMUNITY_ACCOUNT,
        payload,
    };
};

export const createCommunityAccountPending = payload => ({
    type: CREATE_COMMUNITY_ACCOUNT_PENDING,
    payload,
});

export const createCommunityAccountError = payload => {
    return {
        type: CREATE_COMMUNITY_ACCOUNT_ERROR,
        payload,
    };
};

export const createCommunitySuccess = payload => ({
    type: CREATE_COMMUNITY_SUCCESS,
    payload,
});

export const communityHivemindOperation = payload => {
    return {
        type: COMMUNITY_HIVEMIND_OPERATION,
        payload,
    };
};
export const communityHivemindOperationPending = payload => ({
    type: COMMUNITY_HIVEMIND_OPERATION_PENDING,
    payload,
});
export const communityHivemindOperationError = payload => ({
    type: COMMUNITY_HIVEMIND_OPERATION_ERROR,
    payload,
});
