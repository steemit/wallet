import React from 'react';
import tt from 'counterpart';
import { APP_NAME } from 'app/client_config';
import * as appActions from 'app/redux/AppReducer';

class Support extends React.Component {
    componentWillMount() {
        this.props.setRouteTag();
    }
    render() {
        return (
            <div className="row">
                <div>
                    <h2>{tt('g.APP_NAME_support', { APP_NAME })}</h2>
                    <p>
                        {tt('g.please_email_questions_to')}{' '}
                        <a href="mailto:contact@steemit.com">
                            contact@steemit.com
                        </a>.
                    </p>
                </div>
            </div>
        );
    }
}

module.exports = {
    path: 'support.html',
    component: connect(
        (state, ownProps) => ({}),
        dispatch => ({
            setRouteTag: () =>
                dispatch(appActions.setRouteTag({ routeTag: 'support' })),
        })
    )(Support),
};
