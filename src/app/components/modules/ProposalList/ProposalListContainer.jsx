import React from 'react';
import PropTypes from 'prop-types';

import ProposalList from './ProposalList';

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired, // TODO: Specify shape.
    voteOnProposal: PropTypes.func.isRequired,
    loading: PropTypes.bool.isRequired,
    total_vesting_shares: PropTypes.number.isRequired,
    total_vesting_fund_steem: PropTypes.number.isRequired,
};

class ProposalListContainer extends React.Component {
    constructor(props) {
        // console.log('ProposalListContainer.jsx::constructor()', props);
        super(props);
    }

    async componentWillMount() {
        // await console.log('ProposalListContainer.jsx::componentWillMount()');
    }

    render() {
        // const { proposals, voteOnProposal, loading } = this.props;
        // console.log('ProposalListContainer.jsx::render()', arguments);

        return <ProposalList {...this.props} />;
    }
}

export default ProposalListContainer;
