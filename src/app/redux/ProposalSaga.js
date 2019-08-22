import { api } from '@steemit/steem-js';
import { call, put, takeEvery } from 'redux-saga/effects';
import * as proposalActions from './ProposalReducer';

const LIST_PROPOSALS = 'fetchDataSaga/LIST_PROPOSALS';
const LIST_VOTED_ON_PROPOSALS = 'fetchDataSaga/LIST_VOTED_ON_PROPOSALS';
// const LIST_VOTER_PROPOSALS = 'fetchDataSaga/LIST_VOTER_PROPOSALS';

export const proposalWatches = [
    takeEvery(LIST_PROPOSALS, listProposalsCaller),
    takeEvery(LIST_VOTED_ON_PROPOSALS, listVotedOnProposalsCaller),
    // takeEvery(LIST_VOTER_PROPOSALS, listVoterProposalsCaller),
];

export function* listProposalsCaller(action) {
    yield listProposals(action.payload);
}

export function* listVotedOnProposalsCaller(action) {
    yield listVotedOnProposals(action.payload);
}

// export function* listVoterProposalsCaller(action) {
//     yield listVoterProposals(action.payload);
// }

export function* listProposals({
    voter_id,
    last_proposal,
    order_by,
    order_direction,
    limit,
    status,
    resolve,
    reject,
}) {
    console.log(
        'ProposalSaga->listProposals()::voter_id, last_proposal, order_by, order_direction, limit, status',
        voter_id,
        last_proposal,
        order_by,
        order_direction,
        limit,
        status
    );
    let start = [];
    if (last_proposal) {
        //TODO: Switch on the logic for the different types of orders.
        start = [last_proposal.id];
    }

    const proposals = yield call(
        [api, api.listProposalsAsync],
        start,
        limit,
        order_by,
        order_direction,
        status
    );
    console.log('ProposalSaga->listProposals()::proposals', proposals);

    const proposalIds = proposals.map(p => {
        return p.id;
    });
    console.log('ProposalSaga->listProposals()::proposalIds', proposalIds);

    let proposalVotesIds = [];
    if (voter_id) {
        const proposalVotes = yield call(
            [api, api.listProposalVotesAsync],
            proposalIds,
            limit,
            'by_proposal_voter',
            'ascending',
            'all'
        );
        console.log(
            'ProposalSaga->listProposals()::proposalVotes',
            proposalVotes
        );

        proposalVotesIds = proposalVotes
            .filter(d => {
                return d.voter == voter_id;
            })
            .map(p => {
                return p.id;
            });
        console.log(
            'ProposalSaga->listProposals()::proposalVotesIds',
            proposalVotesIds
        );
    }
    const mungedProposals = proposals.map(p => {
        if (proposalVotesIds.indexOf(p.proposal_id) != -1) {
            p.upVoted = true;
        }
        p.upVoted = false;
        return p;
    });

    console.log(
        'ProposalSaga->listProposals()::mungedProposals',
        mungedProposals
    );

    yield put(proposalActions.receiveListProposals({ mungedProposals }));
    if (resolve && mungedProposals) {
        resolve(mungedProposals);
    } else if (reject && !mungedProposals) {
        reject();
    }
}

export function* listVotedOnProposals({
    voter_id,
    limit,
    order_by,
    order_direction,
    status,
    resolve,
    reject,
}) {
    console.log(
        'ProposalSaga->listVotedOnProposals()::voter_id, limit, order_by, order_direction, status',
        voter_id,
        limit,
        order_by,
        order_direction,
        status
    );
    if (!voter_id) {
        reject();
    }
    try {
        const data = yield call(
            [api, api.listProposalVotesAsync],
            [],
            limit,
            // 'by_proposal_voter',
            'by_voter_proposal',
            order_direction,
            status
        );
        console.log('ProposalSaga->listVotedOnProposals()::data', data);
        const proposals = data.filter(d => {
            return d.voter == voter_id;
        });
        console.log(`Proposals matching a vote from '${voter_id}', proposals`);
        yield put(
            proposalActions.receiveListProposalVotes({
                proposals,
            })
        );
        if (resolve && proposals) {
            resolve(proposals);
        } else if (reject && !proposals) {
            reject();
        }
    } catch (e) {
        console.error('ProposalSaga->listProposalVotesAsync::error', e);
    }
}

// export function* listVoterProposals({
//     start,
//     order_by,
//     order_direction,
//     limit,
//     status,
//     resolve,
//     reject,
// }) {
//     let voterProposals = { [start]: [] };
//     let last_id = null;
//     let isLast = false;
//
//     while (!isLast) {
//         console.log(
//             'ProposalSaga->listVoterProposals()::start, order_by, order_direction, limit, status',
//             start,
//             order_by,
//             order_direction,
//             limit,
//             status
//         );
//
//         const data = yield call(
//             [api, api.listVoterProposalsAsync],
//             [start],
//             limit,
//             order_by,
//             order_direction,
//             status
//         );
//
//         if (data) {
//             if (!data.hasOwnProperty(start)) {
//                 isLast = true;
//             } else {
//                 let proposals = [];
//
//                 if (data[start].length < limit) {
//                     proposals = [...voterProposals[start], ...data[start]];
//                     isLast = true;
//                 } else {
//                     const nextProposals = [...data[start]];
//                     last_id = nextProposals[nextProposals.length - 1].id;
//                     nextProposals.splice(-1, 1);
//                     proposals = [...voterProposals[start], ...nextProposals];
//                 }
//
//                 voterProposals = { [start]: proposals };
//             }
//         }
//     }
//
//     yield put(proposalActions.receiveListVoterProposals({ voterProposals }));
//     if (resolve && voterProposals[start].length > 0) {
//         console.log(
//             'if (resolve && voterProposals[start].length > 0){',
//             voterProposals
//         );
//         resolve(voterProposals);
//     } else if (reject && !voterProposals) {
//         reject();
//     }
// }

// Action creators
export const actions = {
    listProposals: payload => ({
        type: LIST_PROPOSALS,
        payload,
    }),

    listVotedOnProposals: payload => ({
        type: LIST_VOTED_ON_PROPOSALS,
        payload,
    }),

    // listVoterProposals: payload => ({
    //     type: LIST_VOTER_PROPOSALS,
    //     payload,
    // }),
};
