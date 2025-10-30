import React from 'react';
import PropTypes from 'prop-types';
import ProposalsComponent from 'app/components/modules/Proposals';

class Proposals extends React.Component {
    render() {
        return (
            <ProposalsComponent />
        )
    }
}

Proposals.propTypes = {
    listProposals: PropTypes.func.isRequired,
    createProposal: PropTypes.func.isRequired,
    voteOnProposal: PropTypes.func.isRequired,
};

module.exports = {
    path: 'proposals',
    component: Proposals,
};
