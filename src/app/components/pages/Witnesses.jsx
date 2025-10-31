import React from 'react';
import WitnessesComponent from 'app/components/modules/Witnesses';

class Witnesses extends React.Component {
    render() {
        return (
            <WitnessesComponent />
        );
    }
}

module.exports = {
    path: '/~witnesses(/:witness)',
    component: Witnesses,
};
