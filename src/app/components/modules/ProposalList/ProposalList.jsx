import React from 'react';
import PropTypes from 'prop-types';

import ProposalContainer from './ProposalContainer';

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired,
    voteOnProposal: PropTypes.func.isRequired,
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
    // console.log('ProposalList.jsx->()', props);
    const { proposals, voteOnProposal, loading } = props;
    const proposalCount = proposals.length;

    if (!loading && proposalCount == 0) {
        return (
            <center>
                <h5>
                    Sorry, I can't show you any proposals right now.<br />
                    <small>
                        It's probably because there are not any matching your
                        criteria.
                    </small>
                </h5>
            </center>
        );
    } else if (loading && proposals.length == 0) {
        return (
            <center>
                <h5>
                    Loading<br />
                    <small>It's worth the wait. ;)</small>
                </h5>
            </center>
        );
    }

    return (
        <div className="ProposalsList">
            <div className="proposals__header">
                <div className="proposals__votes">Vote SP</div>
                <div className="proposals__description">Proposal</div>
                <div className="proposals__amount">Amount</div>
            </div>
            {proposals.map(proposal => (
                <ProposalContainer
                    key={proposal.id}
                    voteOnProposal={voteOnProposal}
                    proposal={proposal}
                />
            ))}
        </div>
    );
}
