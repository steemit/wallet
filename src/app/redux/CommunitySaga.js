import { call, put, takeLatest, select } from 'redux-saga/effects';
import * as dsteem from 'dsteem';
import * as communityActions from './CommunityReducer';
import { wait } from './MarketSaga';

// TODO: use steem endpoint from env var.

const usernameSelector = state => state.user.current.username;
const activeKeySelector = state => {
    return state.user.getIn(['pub_keys_used']).active;
};
const communityTitleSelector = state => state.community.communityTitle;

const generateAuth = (user, pass, type) => {
    const key = dsteem.PrivateKey.fromLogin(user, pass, type).createPublic();
    if (type == 'memo') return key;
    return { weight_threshold: 1, account_auths: [], key_auths: [[key, 1]] };
};

const generateHivemindOperation = (
    action,
    params,
    actor_name,
    actor_posting
) => {
    return [
        'custom_json',
        {
            required_auths: [],
            required_posting_auths: [actor_name],
            id: 'community',
            json: JSON.stringify([action, params]),
        },
    ];
};

export const communityWatches = [
    takeLatest(
        communityActions.CREATE_COMMUNITY_ACCOUNT,
        createCommunityAccount
    ),
];

export function* createCommunityAccount(createCommunityAction) {
    const dSteemClient = new dsteem.Client('https://api.steemit.com');
    debugger;
    yield put({
        type: communityActions.createCommunityAccountPending,
        payload: true,
    });
    const {
        accountName,
        communityTitle,
        communityDescription,
        communityNSFW,
        communityOwnerName,
        communityOwnerWifPassword,
    } = createCommunityAction.payload;
    debugger;

    try {
        // Get the currently logged in user active key.
        const creatorActiveKey = yield select(activeKeySelector);

        const op = [
            'account_create',
            {
                fee: '3.00 STEEM',
                creator: accountName,
                owner: generateAuth(
                    communityOwnerName,
                    communityOwnerWifPassword,
                    'owner'
                ),
                active: generateAuth(
                    communityOwnerName,
                    communityOwnerWifPassword,
                    'active'
                ),
                posting: generateAuth(
                    communityOwnerName,
                    communityOwnerWifPassword,
                    'posting'
                ),
                memo_key: generateAuth(
                    communityOwnerPosting,
                    communityOwnerWifPassword,
                    'memo'
                ),
                json_metadata: '',
            },
        ];
        debugger;

        yield call(
            [dSteemClient, dSteemClient.broadcast.sendOperations],
            [op],
            creatorActiveKey
        );

        // The client cannot submit custom_json and account_create in the same block. The easiest way around this, for now, is to pause for 3 seconds after the account is created before submitting the ops.
        yield call(wait, 3000);
        debugger;
        const communityOwnerPosting = dsteem.PrivateKey.fromLogin(
            communityOwnerName,
            communityOwnerWifPassword,
            'posting'
        );
        const setRoleOperation = generateHivemindOperation(
            'setRole',
            { communityOwnerName, account: accountName, role: 'admin' },
            communityOwnerName,
            communityOwnerPosting
        );
        // TODO: Should this op update the community description and NSFW prop?
        const updatePropsOperation = generateHivemindOperation(
            'updateProps',
            { communityOwnerName, props: { title: communityTitle } },
            communityOwnerName,
            communityOwnerPosting
        );
        yield call(
            [dSteemClient, dSteemClient.broadcast.sendOperations],
            [setRoleOperation, updatePropsOperation]
        );
        debugger;
        yield put({
            type: communityActions.createCommunitySuccess,
            payload: true,
        });
    } catch (error) {
        debugger;
        console.log(error);
        yield put({
            type: communityActions.createCommunityAccountError,
            payload: true,
        });
    }
    yield put({
        type: communityActions.createCommunityAccountPending,
        payload: false,
    });
}
