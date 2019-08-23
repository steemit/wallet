import { call, put, takeLatest, select } from 'redux-saga/effects';
import * as dsteem from 'dsteem';
import * as communityActions from './CommunityReducer';
import { wait } from './MarketSaga';

// TODO: use steem endpoint from env var.
const dSteemClient = new dsteem.Client('https://api.steemit.com');

const usernameSelector = state => state.user.current.username;
const activeKeySelector = state => state.user.current.pub_keys_used.active;
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
    takeLatest(communityActions.createCommunityAccount, createCommunityAccount),
];

export function* createCommunityAccount(createCommunityAction) {
    yield put({
        type: communityActions.createCommunityAccountPending,
        payload: true,
    });
    const { community, password } = createCommunityAction.payload;
    try {
        // Get the currently logged in user.
        const creatorName = yield select(usernameSelector);
        const creatorActiveKey = yield select(activeKeySelector);
        const op = [
            'account_create',
            {
                fee: '3.00 STEEM',
                creator: creatorName,
                owner: generateAuth(community, password, 'owner'),
                active: generateAuth(community, password, 'active'),
                posting: generateAuth(community, password, 'posting'),
                memo_key: generateAuth(community, password, 'memo'),
                json_metadata: '',
            },
        ];
        yield call(
            dSteemClient.broadcast.sendOperations,
            [op],
            creatorActiveKey
        );
        // The client cannot submit custom_json and account_create in the same block. The easiest way around this, for now, is to pause for 3 seconds after the account is created before submitting the ops.
        yield call(wait, 3000);
        // Call the custom ops sagas.
        const ownerPosting = dsteem.PrivateKey.fromLogin(
            community,
            password,
            'posting'
        );
        const communityTitle = yield select(communityTitleSelector);
        const setRoleOperation = generateHivemindOperation(
            'setRole',
            { community, account: creatorName, role: 'admin' },
            community,
            ownerPosting
        );
        const updatePropsOperation = generateHivemindOperation(
            'updateProps',
            { community, props: { title: communityTitle } },
            community,
            ownerPosting
        );
        yield call(dSteemClient.broadcast.sendOperations, [
            setRoleOperation,
            updatePropsOperation,
        ]);
    } catch (error) {
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
