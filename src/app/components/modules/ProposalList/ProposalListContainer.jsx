import React from 'react';
import PropTypes from 'prop-types';

import ProposalList from './ProposalList';

class ProposalListContainer extends React.Component {
    constructor(props) {
        super(props);
    }

    render() {
        return <ProposalList {...this.props} />;
    }
}

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired, // TODO: Specify shape.
    voteOnProposal: PropTypes.func.isRequired,
    loading: PropTypes.bool.isRequired,
};

export default ProposalListContainer;
