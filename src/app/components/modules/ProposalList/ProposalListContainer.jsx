import React from 'react';
import PropTypes from 'prop-types';

import ProposalList from './ProposalList';

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired, // TODO: Specify shape.
    upvoteProposal: PropTypes.func.isRequired,
    loading: PropTypes.bool.isRequired,
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
        const { proposals, upvoteProposal, loading } = this.props;
        // console.log('ProposalListContainer.jsx::render()', arguments);

        return <ProposalList {...this.props} />;
    }
}

export default ProposalListContainer;
