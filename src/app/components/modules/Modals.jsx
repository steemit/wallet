/* eslint-disable react/forbid-prop-types */
/* eslint-disable no-undef */
/* eslint-disable react/sort-comp */
import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import CloseButton from 'app/components/elements/CloseButton';
import Reveal from 'app/components/elements/Reveal';
import { NotificationStack } from 'react-notification';
import tt from 'counterpart';
import * as userActions from 'app/redux/UserReducer';
import * as appActions from 'app/redux/AppReducer';
import * as transactionActions from 'app/redux/TransactionReducer';
import LoginForm from 'app/components/modules/LoginForm';
import ConfirmTransactionForm from 'app/components/modules/ConfirmTransactionForm';
import Transfer from 'app/components/modules/Transfer';
import SignUp from 'app/components/modules/SignUp';
import Powerdown from 'app/components/modules/Powerdown';
import RouteSettings from 'app/components/elements/RouteSettings';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import TermsAgree from 'app/components/modules/TermsAgree';

class Modals extends React.Component {
    static defaultProps = {
        username: '',
        notifications: undefined,
        removeNotification: () => {},
        show_terms_modal: false,
        show_signup_modal: false,
        show_bandwidth_error_modal: false,
        show_powerdown_modal: false,
        show_advanced_modal: false,
        show_transfer_modal: false,
        show_confirm_modal: false,
        show_login_modal: false,
        show_post_advanced_settings_modal: '',
        show_vote_modal: false,
        loading: false,
    };
    static propTypes = {
        show_vote_modal: PropTypes.bool,
        show_login_modal: PropTypes.bool,
        show_confirm_modal: PropTypes.bool,
        show_transfer_modal: PropTypes.bool,
        show_powerdown_modal: PropTypes.bool,
        show_advanced_modal: PropTypes.bool,
        show_bandwidth_error_modal: PropTypes.bool,
        show_signup_modal: PropTypes.bool,
        show_post_advanced_settings_modal: PropTypes.string,
        hideLogin: PropTypes.func.isRequired,
        username: PropTypes.string,
        hideConfirm: PropTypes.func.isRequired,
        hideSignUp: PropTypes.func.isRequired,
        hideTransfer: PropTypes.func.isRequired,
        hidePowerdown: PropTypes.func.isRequired,
        hideAdvanced: PropTypes.func.isRequired,
        hideBandwidthError: PropTypes.func.isRequired,
        hideVote: PropTypes.func.isRequired,
        notifications: PropTypes.object,
        show_terms_modal: PropTypes.bool,
        removeNotification: PropTypes.func,
        loading: PropTypes.bool,
    };

    constructor() {
        super();
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'Modals');
    }

    render() {
        const {
            show_vote_modal,
            show_login_modal,
            show_confirm_modal,
            show_transfer_modal,
            show_powerdown_modal,
            show_advanced_modal,
            show_signup_modal,
            show_bandwidth_error_modal,
            show_post_advanced_settings_modal,
            hideLogin,
            hideTransfer,
            hidePowerdown,
            hideAdvanced,
            hideConfirm,
            hideSignUp,
            show_terms_modal,
            notifications,
            removeNotification,
            hideBandwidthError,
            username,
            hideVote,
            loading,
        } = this.props;

        const notifications_array = notifications
            ? notifications.toArray().map(n => {
                  n.onClick = () => removeNotification(n.key);
                  return n;
              })
            : [];

        const buySteemPower = e => {
            if (e && e.preventDefault) e.preventDefault();
            const new_window = window.open();
            new_window.opener = null;
            new_window.location =
                'https://poloniex.com/trade/STEEM_TRX/?type=spot';
        };

        return (
            <div>
                {show_vote_modal && (
                    <Reveal onHide={hideVote} show={show_vote_modal}>
                        <CloseButton onClick={hideVote} />
                    </Reveal>
                )}
                {show_login_modal && (
                    <Reveal onHide={hideLogin} show={show_login_modal}>
                        <CloseButton onClick={hideLogin} />
                        <LoginForm onCancel={hideLogin} />
                    </Reveal>
                )}
                {show_confirm_modal && (
                    <Reveal onHide={hideConfirm} show={show_confirm_modal}>
                        <CloseButton onClick={hideConfirm} />
                        <ConfirmTransactionForm onCancel={hideConfirm} />
                    </Reveal>
                )}
                {show_transfer_modal && (
                    <Reveal onHide={hideTransfer} show={show_transfer_modal}>
                        <CloseButton onClick={hideTransfer} />
                        <Transfer />
                    </Reveal>
                )}
                {show_powerdown_modal && (
                    <Reveal onHide={hidePowerdown} show={show_powerdown_modal}>
                        <CloseButton onClick={hidePowerdown} />
                        <Powerdown />
                    </Reveal>
                )}
                {show_advanced_modal && (
                    <Reveal onHide={hideAdvanced} show={show_advanced_modal}>
                        <CloseButton onClick={hideAdvanced} />
                        <RouteSettings />
                    </Reveal>
                )}
                {show_signup_modal && (
                    <Reveal onHide={hideSignUp} show={show_signup_modal}>
                        <CloseButton onClick={hideSignUp} />
                        <SignUp />
                    </Reveal>
                )}
                {show_terms_modal && (
                    <Reveal show={show_terms_modal}>
                        <TermsAgree onCancel={hideLogin} />
                    </Reveal>
                )}
                {show_bandwidth_error_modal && (
                    <Reveal
                        onHide={hideBandwidthError}
                        show={show_bandwidth_error_modal}
                    >
                        <div>
                            <CloseButton onClick={hideBandwidthError} />
                            <h4>{tt('modals_jsx.your_transaction_failed')}</h4>
                            <hr />
                            <h5>{tt('modals_jsx.out_of_bandwidth_title')}</h5>
                            <p>{tt('modals_jsx.out_of_bandwidth_reason')}</p>
                            <p>{tt('modals_jsx.out_of_bandwidth_reason_2')}</p>
                            <p>
                                {tt('modals_jsx.out_of_bandwidth_option_title')}
                            </p>
                            <ol>
                                <li>
                                    {tt('modals_jsx.out_of_bandwidth_option_4')}
                                </li>
                                <li>
                                    {tt('modals_jsx.out_of_bandwidth_option_1')}
                                </li>
                                <li>
                                    {tt('modals_jsx.out_of_bandwidth_option_2')}
                                </li>
                                <li>
                                    {tt('modals_jsx.out_of_bandwidth_option_3')}
                                </li>
                            </ol>
                            <button className="button" onClick={buySteemPower}>
                                {tt('g.buy_steem_power')}
                            </button>
                        </div>
                    </Reveal>
                )}
                <NotificationStack
                    style={{}}
                    notifications={notifications_array}
                    onDismiss={n => removeNotification(n.key)}
                />
            </div>
        );
    }
}

export default connect(
    state => {
        return {
            username: state.user.getIn(['current', 'username']),
            show_login_modal: state.user.get('show_login_modal'),
            show_confirm_modal: state.transaction.get('show_confirm_modal'),
            show_transfer_modal: state.user.get('show_transfer_modal'),
            show_powerdown_modal: state.user.get('show_powerdown_modal'),
            show_advanced_modal: state.user.get('show_advanced_modal'),
            show_signup_modal: state.user.get('show_signup_modal'),
            show_vote_modal: state.user.get('show_vote_modal'),
            notifications: state.app.get('notifications'),
            show_terms_modal:
                state.user.get('show_terms_modal') &&
                state.routing.locationBeforeTransitions.pathname !==
                    '/tos.html' &&
                state.routing.locationBeforeTransitions.pathname !==
                    '/privacy.html',
            show_bandwidth_error_modal: state.transaction.getIn([
                'errors',
                'bandwidthError',
            ]),
            show_post_advanced_settings_modal: state.user.get(
                'show_post_advanced_settings_modal'
            ),
            loading: state.app.get('modalLoading'),
        };
    },
    dispatch => ({
        hideVote: e => {
            if (e) e.preventDefault();
            dispatch(userActions.hideVote());
        },
        hideLogin: e => {
            if (e) e.preventDefault();
            dispatch(userActions.hideLogin());
        },
        hideConfirm: e => {
            if (e) e.preventDefault();
            dispatch(transactionActions.hideConfirm());
        },
        hideTransfer: e => {
            if (e) e.preventDefault();
            dispatch(userActions.hideTransfer());
        },
        hidePowerdown: e => {
            if (e) e.preventDefault();
            dispatch(userActions.hidePowerdown());
        },
        hideAdvanced: e => {
            if (e) e.preventDefault();
            dispatch(userActions.hideAdvanced());
        },
        hideSignUp: e => {
            if (e) e.preventDefault();
            dispatch(userActions.hideSignUp());
        },
        hideBandwidthError: e => {
            if (e) e.preventDefault();
            dispatch(
                transactionActions.dismissError({ key: 'bandwidthError' })
            );
        },
        // example: addNotification: ({key, message}) => dispatch({type: 'ADD_NOTIFICATION', payload: {key, message}}),
        removeNotification: key =>
            dispatch(appActions.removeNotification({ key })),
    })
)(Modals);
