import React from 'react';
import PropTypes from 'prop-types';

import ProposalList from './ProposalList';

ProposalList.propTypes = {
    proposals: PropTypes.array.isRequired, // TODO: Specify shape.
    upvoteProposal: PropTypes.func.isRequired,
};

class ProposalListContainer extends React.Component {
    constructor(props) {
        console.log('ProposalListContainer.jsx::constructor()', props);
        super(props);
        this.state = {};
    }

    async componentWillMount() {
        await console.log('ProposalListContainer.jsx::componentWillMount()');
    }

    render() {
        const { proposals, upvoteProposal } = this.props;
        console.log('ProposalListContainer.jsx::render()', arguments);

        return (
            <ProposalList
                upvoteProposal={upvoteProposal}
                proposals={proposals}
            />
        );
    }
}

export default ProposalListContainer;
