import React from 'react';
import { connect } from 'react-redux';
import HelpContent from 'app/components/elements/HelpContent';
import * as appActions from 'app/redux/AppReducer';

class Welcome extends React.Component {
    componentWillMount() {
        this.props.setRouteTag();
    }
    render() {
        return (
            <div className="row">
                <div className="column large-8 medium-10 small-12">
                    <HelpContent path="welcome" />
                </div>
            </div>
        );
    }
}

module.exports = {
    path: 'welcome',
    component: connect(
        (state, ownProps) => ({}),
        dispatch => ({
            setRouteTag: () =>
                dispatch(appActions.setRouteTag({ routeTag: 'welcome' })),
        })
    )(Welcome),
};
