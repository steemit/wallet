import React from 'react';
import PropTypes from 'prop-types';

import ProposalContainer from './ProposalContainer';

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired,
    upvoteProposal: PropTypes.func.isRequired,
    loading: PropTypes.bool.isRequired,
    // proposals: PropTypes.arrayOf(
    //     PropTypes.shape({
    //         color: PropTypes.string.isRequired,
    //         fontSize: PropTypes.number.isRequired,
    //     })
    // ).isRequired,
    // name: PropTypes.string.isRequired,
    // logo: PropTypes.string.isRequired,
    // total_cost: PropTypes.number.isRequired,
    // total_net_profit: PropTypes.number.isRequired,
    // total_gross_profit: PropTypes.number.isRequired,
};

export default function ProposalList(props) {
    console.log('ProposalList.jsx->()', props);
    const { proposals, upvoteProposal, loading } = props;

    return (
        <div className="ProposalsList">
            <div className="proposals__header">
                <div className="proposals__votes">Votes</div>
                <div className="proposals__description">Proposal</div>
                <div className="proposals__amount">Amount</div>
            </div>
            {proposals.map(proposal => (
                <ProposalContainer
                    key={proposal.id}
                    upvoteProposal={upvoteProposal}
                    proposal={proposal}
                />
            ))}
            {loading ? <h2>Loading...</h2> : ''}
        </div>
    );
}
