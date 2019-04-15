import { api } from '@blocktradesdev/steem-js';
import { call, put, takeEvery } from 'redux-saga/effects';
import * as proposalActions from './ProposalReducer';

const LIST_PROPOSALS = 'fetchDataSaga/LIST_PROPOSALS';
const LIST_VOTER_PROPOSALS = 'fetchDataSaga/LIST_VOTER_PROPOSALS';

export const proposalWatches = [
    takeEvery(LIST_PROPOSALS, listProposalsCaller),
    takeEvery(LIST_VOTER_PROPOSALS, listVoterProposalsCaller),
];

export function* listProposalsCaller(action) {
    yield listProposals(action.payload);
}

export function* listVoterProposalsCaller(action) {
    yield listVoterProposals(action.payload);
}

export function* listProposals({
    start,
    order_by,
    order_direction,
    limit,
    status,
    last_id,
    resolve,
    reject,
}) {
    let proposals;
    while (!proposals) {
        if (status === 'voted') {
            const voterProposals = yield call(
                [api, api.listVoterProposalsAsync],
                start,
                order_by,
                order_direction,
                limit,
                'votable',
                last_id
            );

            proposals = voterProposals[start];
        } else {
            proposals = yield call(
                [api, api.listProposalsAsync],
                start,
                order_by,
                order_direction,
                limit,
                status,
                last_id
            );
        }
    }

    yield put(proposalActions.receiveListProposals({ proposals }));
    if (resolve && proposals) {
        resolve(proposals);
    } else if (reject && !proposals) {
        reject();
    }
}

export function* listVoterProposals({
    start,
    order_by,
    order_direction,
    limit,
    status,
    resolve,
    reject,
}) {
    let voterProposals = { [start]: [] };
    let last_id = null;
    let isLast = false;

    while (!isLast) {
        const data = yield call(
            [api, api.listVoterProposalsAsync],
            start,
            order_by,
            order_direction,
            limit,
            status,
            last_id
        );

        if (data) {
            if (!data.hasOwnProperty(start)) {
                isLast = true;
            } else {
                let proposals = [];

                if (data[start].length < limit) {
                    proposals = [...voterProposals[start], ...data[start]];
                    isLast = true;
                } else {
                    const nextProposals = [...data[start]];
                    last_id = nextProposals[nextProposals.length - 1]['id'];
                    nextProposals.splice(-1, 1);
                    proposals = [...voterProposals[start], ...nextProposals];
                }

                voterProposals = { [start]: proposals };
            }
        }
    }

    yield put(proposalActions.receiveListVoterProposals({ voterProposals }));
    if (resolve && voterProposals[start].length > 0) {
        resolve(voterProposals);
    } else if (reject && !voterProposals) {
        reject();
    }
}

// Action creators
export const actions = {
    listProposals: payload => ({
        type: LIST_PROPOSALS,
        payload,
    }),

    listVoterProposals: payload => ({
        type: LIST_VOTER_PROPOSALS,
        payload,
    }),
};
