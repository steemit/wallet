import { call, put, takeLatest, select } from 'redux-saga/effects';
import { api, broadcast, auth } from '@steemit/steem-js';
import { PrivateKey } from '@steemit/steem-js/lib/auth/ecc';
import * as communityActions from './CommunityReducer';
import * as transactionActions from './TransactionReducer';
import { wait } from './MarketSaga';

const activeKeySelector = state => {
    return state.user.getIn(['pub_keys_used']).active;
};

const generateAuth = (user, pass, type) => {
    const key = auth.getPrivateKeys(user, pass, [type]);
    const publicKey = auth.wifToPublic(Object.values(key)[0]);
    if (type == 'memo') return publicKey;
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
        const op = {
            fee: '3.000 STEEM',
            creator: accountName,
            new_account_name: communityOwnerName,
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

        yield put(
            transactionActions.broadcastOperation({
                type: 'account_create',
                confirm: 'Are you sure?',
                operation: op[1],
                successCallback: res => {
                    console.log('success', res);
                },
                errorCallback: res => {
                    console.log('error', res);
                },
            })
        );

        // The client cannot submit custom_json and account_create in the same block. The easiest way around this, for now, is to pause for 3 seconds after the account is created before submitting the ops.
        yield call(wait, 9000);

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

        const setRolePayload = {
            required_auths: [],
            required_posting_auths: [communityOwnerName],
            id: 'community',
            json: JSON.stringify([
                'setRole',
                {
                    community: communityOwnerName,
                    account: accountName,
                    role: 'admin',
                },
            ]),
        };
        const updatePropsPayload = {
            required_auths: [],
            required_posting_auths: [communityOwnerName],
            id: 'community',
            json: JSON.stringify([
                'updateProps',
                {
                    community: communityOwnerName,
                    props: {
                        title: communityTitle /*description: communityDescription*/,
                    },
                },
            ]),
        };

        // SteemJs.
        yield broadcast.sendAsync(
            {
                extensions: [],
                operations: [
                    [
                        'custom_json',
                        {
                            id: 'community',
                            json: setRoleOperation[1].json,
                            required_auths: [],
                            required_posting_auths: [communityOwnerName],
                        },
                    ],
                ],
            },
            [
                auth.toWif(
                    communityOwnerName,
                    communityOwnerWifPassword,
                    'posting'
                ),
            ]
        );

        /*
        yield call(
            [api, broadcast.send],
            [setRoleOperation, updatePropsOperation]
        );
        */
        yield put({
            type: communityActions.CREATE_COMMUNITY_SUCCESS,
            payload: true,
        });
    } catch (error) {
        console.log(error);
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
