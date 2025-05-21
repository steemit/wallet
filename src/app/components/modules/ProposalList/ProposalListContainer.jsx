import React from 'react';
import PropTypes from 'prop-types';

import ProposalList from './ProposalList';

class ProposalListContainer extends React.Component {
    render() {
        return <ProposalList {...this.props} />;
    }
}

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired,
    voteOnProposal: PropTypes.func.isRequired,
    loading: PropTypes.bool.isRequired,
    onFilter: PropTypes.func.isRequired,
    onOrder: PropTypes.func.isRequired,
    onOrderDirection: PropTypes.func.isRequired,
};

export default ProposalListContainer;
