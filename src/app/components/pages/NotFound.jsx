import React from 'react';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import Icon from 'app/components/elements/Icon';
import * as appActions from 'app/redux/AppReducer';

class NotFound extends React.Component {
    componentWillMount() {
        this.props.setRouteTag && this.props.setRouteTag();
    }
    render() {
        return (
            <div>
                <div className="Header__top header">
                    <div className="columns">
                        <div className="top-bar-left">
                            <ul className="menu">
                                <li className="Header__top-logo">
                                    <Link to="/">
                                        <Icon name="steem" size="2x" />
                                    </Link>
                                </li>
                                <li className="Header__top-steemit show-for-medium noPrint">
                                    <a href="/">steemit</a>
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>
                <div className="NotFound float-center">
                    <div>
                        <Icon name="steem" size="4x" />
                        <h4 className="NotFound__header">
                            Sorry! This page doesn't exist.
                        </h4>
                        <p>
                            Not to worry. You can head back to{' '}
                            <a style={{ fontWeight: 800 }} href="/">
                                our homepage
                            </a>, or check out some great posts.
                        </p>
                        <ul className="NotFound__menu">
                            <li>
                                <a href="/created">new posts</a>
                            </li>
                            <li>
                                <a href="/hot">hot posts</a>
                            </li>
                            <li>
                                <a href="/trending">trending posts</a>
                            </li>
                            <li>
                                <a href="/promoted">promoted posts</a>
                            </li>
                            <li>
                                <a href="/active">active posts</a>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
        );
    }
}

module.exports = {
    path: '*',
    component: connect(
        (state, ownProps) => ({}),
        dispatch => {
            return {
                setRouteTag: () =>
                    dispatch(appActions.setRouteTag({ routeTag: 'not_found' })),
            };
        }
    )(NotFound),
    serverRenderComponent: NotFound,
};
