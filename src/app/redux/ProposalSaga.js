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

/*
async function getVotesOnProposalById(proposal) {
    let votes = [];
    let nextVotes = [];
    let beyondThisProposal = false;
    while(true) {
        nextVotes = call(
            [api, api.listProposalVotesAsync],
            [proposal],
            100,
            'by_proposal_voter',
            'ascending',
            'all'
        );
        votes.push(nextVotes);
        if(nextVotes.count() < 100)
            return votes;
        beyondThisProposal = nextVotes.map(p => {
            if(p.proposal_id != proposal)
                return true;
        })
        if(beyondThisProposal)
            return votes;
    }
}*/

/*
export function* getNextProposalVotes(proposalId, startVoter, limit) {
    return yield call(
        [api, api.listProposalVotesAsync],
        [proposalId, startVoter],
        limit,
        'by_proposal_voter',
        'ascending',
        'all'
    );
}*/

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
    const start = [-1, 0];
    if (last_proposal) {
        //TODO: Switch on the logic for the different types of orders.
        // start = [last_proposal.id];
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
    console.log('ProposalSaga->listProposals()::if(voter_id)', voter_id);
    
    if (voter_id) {

        let proposalVotes = yield proposalIds.map(function* (pId) {
            let votes = [];
            let nextVotes = [];
            let lastVoter = "";
            let beyondThisProposal = false;
            let maxVotes = 100;
            // ¯\_(ツ)_/¯
            while(true) {
                nextVotes = yield call(
                    [api, api.listProposalVotesAsync],
                    [pId, lastVoter],
                    maxVotes,
                    'by_proposal_voter',
                    'ascending',
                    'all'
                );
                votes = votes.concat(nextVotes);
                lastVoter = nextVotes[nextVotes.length-1].voter;
                if(nextVotes.length < maxVotes)
                    return votes;
                beyondThisProposal = false;
                nextVotes.map(d => {
                    if(d.proposal.proposal_id != pId)
                        beyondThisProposal = true;
                });
                if(beyondThisProposal)
                    return votes;
            }
        });

        proposalVotes = proposalVotes.reduce((a, b) => a.concat(b), []);
        
        console.log(
            'ProposalSaga->listProposals()::proposalVotes',
            proposalVotes
        );

        proposalVotesIds = proposalVotes
            .filter(d => {
                console.log(
                    'ProposalSaga->listProposals()::proposalVotes.filter::d.voter == voter_id',
                    d.voter == voter_id,
                    d,
                    voter_id
                );
                return d.voter == voter_id;
            })
            .map(p => {
                console.log(
                    'ProposalSaga->listProposals()::proposalVotes.map((p)',
                    p.proposal.id,
                    p,
                    voter_id
                );
                return p.proposal.id;
            });
        console.log(
            'ProposalSaga->listProposals()::proposalVotesIds',
            proposalVotesIds
        );
    }
    const mungedProposals = proposals.map(p => {
        console.log(
            'ProposalSaga->listProposals()::proposalVotesIds.indexOf(p.proposal_id)',
            proposalVotesIds.indexOf(p.proposal_id),
            proposalVotesIds
        );
        console.log('ProposalSaga->listProposals()::p', p, p.upVoted);
        if (proposalVotesIds.indexOf(p.proposal_id) != -1) {
            p.upVoted = true;
        } else {
            p.upVoted = false;
        }
        console.log('ProposalSaga->listProposals()::p', p, p.upVoted);
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
        console.log(
            `ProposalSaga->listVotedOnProposals()::Proposals matching a vote from '${voter_id}', proposals`
        );
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
