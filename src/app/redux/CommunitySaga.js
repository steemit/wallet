import { call, put, takeLatest, select } from 'redux-saga/effects';
import { api, broadcast, auth } from '@steemit/steem-js';
import { PrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import * as communityActions from './CommunityReducer';
import { wait } from './MarketSaga';

const activeKeySelector = state => {
    return state.user.getIn(['pub_keys_used']).active;
};

const generateAuth = (user, pass, type) => {
    const key = auth.getPrivateKeys(user, pass, [type]);
    const publicKey = auth.wifToPublic(Object.values(key)[0]);
    if (type == 'memo') return Object.values(key)[0];
    return {
        weight_threshold: 1,
        account_auths: [],
        key_auths: [[publicKey, 1]],
    };
};

const generateHivemindOperation = (action, params, actor_name) => {
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
    yield put({
        type: communityActions.CREATE_COMMUNITY_ACCOUNT_PENDING,
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
    try {
        // Get the currently logged in user active key.
        const creatorActiveKey = yield select(activeKeySelector);
        const op = {
            fee: '3.000 STEEM',
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
        };
        yield call(
            [api, broadcast.accountCreate],
            creatorActiveKey,
            op.fee,
            op.creator,
            op.owner,
            op.active,
            op.posting,
            op.memo_key,
            op.json_metadata
        );

        // The client cannot submit custom_json and account_create in the same block. The easiest way around this, for now, is to pause for 3 seconds after the account is created before submitting the ops.
        yield call(wait, 3000);
        const communityOwnerPosting = auth.getPrivateKeys(
            communityOwnerName,
            communityOwnerWifPassword,
            ['posting']
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
            {
                communityOwnerName,
                props: {
                    title: communityTitle,
                    description: communityDescription,
                    is_nsfw: !!communityNSFW,
                },
            },
            communityOwnerName,
            communityOwnerPosting
        );
        yield call(
            [api, broadcast.send],
            [setRoleOperation, updatePropsOperation]
        );
        yield put({
            type: communityActions.CREATE_COMMUNITY_SUCCESS,
            payload: true,
        });
    } catch (error) {
        yield put({
            type: communityActions.CREATE_COMMUNITY_ACCOUNT_ERROR,
            payload: true,
        });
    }
    yield put({
        type: communityActions.CREATE_COMMUNITY_ACCOUNT_PENDING,
        payload: false,
    });
}
