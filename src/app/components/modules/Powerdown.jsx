import React from 'react';
import { connect } from 'react-redux';
import Slider from 'react-rangeslider';
import tt from 'counterpart';
import reactForm from 'app/utils/ReactForm';
import * as globalActions from 'app/redux/GlobalReducer';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import { VEST_TICKER, LIQUID_TICKER, VESTING_TOKEN } from 'app/client_config';
import {
    numberWithCommas,
    spToVestsf,
    vestsToSpf,
    vestsToSp,
    assetFloat,
} from 'app/utils/StateFunctions';
import { userActionRecord } from 'app/utils/ServerApiClient';

class Powerdown extends React.Component {
    constructor(props, context) {
        super(props, context);
        let new_withdraw;
        if (props.to_withdraw - props.withdrawn > 0) {
            new_withdraw = props.to_withdraw - props.withdrawn;
        } else {
            // Set the default withrawal amount to (available - 5 STEEM)
            // This should be removed post hf20
            new_withdraw = Math.max(
                0,
                props.available_shares - spToVestsf(props.state, 5.001)
            );
        }
        this.state = {
            broadcasting: false,
            manual_entry: false,
            new_withdraw,
            remainingPercentage: 100,
            toggleAckRoutes: false,
        };
    }

    componentWillMount() {
        this.updateRemainingPercentage(this.props.withdraw_routes);
    }

    componentDidUpdate(prevProps) {
        if (prevProps.withdraw_routes !== this.props.withdraw_routes) {
            this.updateRemainingPercentage(this.props.withdraw_routes);
        }
    }

    updateRemainingPercentage = (routes) => {
        if (!routes) return;
        const totalRoutedPercentage = routes.reduce((total, route) => total + route.percent, 0);
        const remainingPercentage = 100 - (totalRoutedPercentage / 100);
        this.setState({ remainingPercentage });
    }

    render() {
        const { broadcasting, new_withdraw, manual_entry, remainingPercentage, toggleAckRoutes } = this.state;
        const {
            account,
            available_shares,
            withdrawn,
            to_withdraw,
            vesting_shares,
            delegated_vesting_shares,
            withdraw_routes
        } = this.props;

        const sortedRoutes = withdraw_routes && withdraw_routes.length > 0
            ? [...withdraw_routes].sort((a, b) => b.percent - a.percent)
            : [];
        const hasRoutes = sortedRoutes.length > 0;
        const currentRoutesList = sortedRoutes.map(route => {
            const receive = (route.percent / 10000 * parseFloat(vestsToSp(this.props.state, new_withdraw))).toFixed(3)
            return (
                <tr key={route.to_account}>
                    <td>
                        <a href={`/@${route.to_account}`} style={{ color: '#1FBF8F' }} target="_blank">
                            {route.to_account}
                        </a>
                    </td>
                    <td>{route.percent / 100}%</td>
                    <td>{`${receive} ${route.auto_vest ? 'SP' : tt('advanced_routes.steem')}`}</td>
                </tr>
            );
        });

        const currentRoutes = (
            <div className="WithdrawRoutes small-12">
                <h5>{tt('advanced_routes.current_withdraw_route')}</h5>
                {hasRoutes ? (
                    <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{tt('advanced_routes.account')}</th>
                                    <th>{tt('advanced_routes.percentage')}</th>
                                    <th>{tt('advanced_routes.receive_amount')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {<tr>
                                    <td>
                                        <a href={`/@${account}`} style={{ color: '#1FBF8F' }} target="_blank">
                                            {account}
                                        </a>
                                    </td>
                                    <td>{remainingPercentage}%</td>
                                    <td>{`${(remainingPercentage / 100 * parseFloat(vestsToSp(this.props.state, new_withdraw))).toFixed(3)} ${tt('advanced_routes.steem')}`}</td>
                                </tr>}
                                {currentRoutesList}
                            </tbody>
                        </table>
                    </div>
                ) : (
                        <p>{tt('advanced_routes.no_routes')}</p>
                )}
            </div>
        );

        const formatSp = amount =>
            numberWithCommas(vestsToSp(this.props.state, amount));
        const sliderChange = value => {
            this.setState({ new_withdraw: value, manual_entry: false });
        };
        const inputChange = event => {
            event.preventDefault();
            let value = spToVestsf(
                this.props.state,
                parseFloat(event.target.value.replace(/,/g, ''))
            );
            if (!isFinite(value)) {
                value = new_withdraw;
            }
            this.setState({
                new_withdraw: value,
                manual_entry: event.target.value,
            });
        };
        const powerDown = event => {
            event.preventDefault();
            this.setState({ broadcasting: true, error_message: undefined });
            const successCallback = this.props.successCallback;
            const errorCallback = error => {
                this.setState({
                    broadcasting: false,
                    error_message: String(error),
                });
            };
            // workaround bad math in react-rangeslider
            let withdraw = new_withdraw;
            if (withdraw > vesting_shares - delegated_vesting_shares) {
                withdraw = vesting_shares - delegated_vesting_shares;
            }
            const vesting_shares = `${withdraw.toFixed(6)} ${VEST_TICKER}`;
            this.props.withdrawVesting({
                account,
                vesting_shares,
                equalSp: vestsToSp(this.props.state, withdraw),
                errorCallback,
                successCallback,
            });
        };

        const notes = [];
        if (to_withdraw - withdrawn > 0) {
            const AMOUNT = formatSp(to_withdraw);
            const WITHDRAWN = formatSp(withdrawn);
            notes.push(
                <li key="already_power_down">
                    {tt('powerdown_jsx.already_power_down', {
                        AMOUNT,
                        WITHDRAWN,
                        LIQUID_TICKER,
                    })}
                </li>
            );
        }
        if (delegated_vesting_shares !== 0) {
            const AMOUNT = formatSp(delegated_vesting_shares);
            notes.push(
                <li key="delegating">
                    {tt('powerdown_jsx.delegating', { AMOUNT, LIQUID_TICKER })}
                </li>
            );
        }
        if (notes.length === 0) {
            let AMOUNT = vestsToSpf(this.props.state, new_withdraw) / 4;
            AMOUNT = AMOUNT.toFixed(AMOUNT >= 10 ? 0 : 1);
            notes.push(
                <li key="per_week">
                    {tt('powerdown_jsx.per_week', { AMOUNT, LIQUID_TICKER })}
                </li>
            );
        }
        // NOTE: remove this post hf20
        if (
            new_withdraw >
            vesting_shares -
                delegated_vesting_shares -
                spToVestsf(this.props.state, 5)
        ) {
            const AMOUNT = 5;
            notes.push(
                <li key="warning" className="warning">
                    {tt('powerdown_jsx.warning', { AMOUNT, VESTING_TOKEN })}
                </li>
            );
        }

        if (this.state.error_message) {
            const MESSAGE = this.state.error_message;
            notes.push(
                <li key="error" className="error">
                    {tt('powerdown_jsx.error', { MESSAGE })}
                </li>
            );
        }

        return (
            <div className="PowerdownModal">
                <div className="row">
                    <h3 className="column">
                        {tt('powerdown_jsx.power_down')} {broadcasting}
                    </h3>
                </div>
                <Slider
                    value={new_withdraw}
                    step={0.000001}
                    max={vesting_shares - delegated_vesting_shares}
                    format={formatSp}
                    onChange={sliderChange}
                />
                <p className="powerdown-amount">
                    {tt('powerdown_jsx.amount')}
                    <br />
                    <input
                        value={
                            manual_entry ? manual_entry : formatSp(new_withdraw)
                        }
                        onChange={inputChange}
                        autoCorrect={false}
                    />
                    {LIQUID_TICKER}
                </p>
                <ul className="powerdown-notes">{notes}</ul>
                <div className="row">
                    <div className="column small-12">
                        {currentRoutes}
                    </div>
                </div>
                {hasRoutes && (
                    <div className="row" style={{ marginTop: '0.75rem' }}>
                        <div className="column toggle_container">
                            <span>
                                {tt('advanced_routes.acknowledge_routes')}
                            </span>
                            <label className="switch">
                                <input
                                    name="toggle_check"
                                    type="checkbox"
                                    checked={toggleAckRoutes}
                                    ref="toggle_check"
                                    onChange={(e) => this.setState({ toggleAckRoutes: e.target.checked })}
                                />
                                <span className="slider round" />
                            </label>
                        </div>
                    </div>
                )}
                <button
                    type="submit"
                    className="button"
                    onClick={powerDown}
                    disabled={broadcasting || (hasRoutes && !toggleAckRoutes)}
                >
                    {tt('powerdown_jsx.power_down')}
                </button>
            </div>
        );
    }
}

export default connect(
    // mapStateToProps
    (state, ownProps) => {
        const values = state.user.get('powerdown_defaults');
        const account = values.get('account');
        const to_withdraw = parseFloat(values.get('to_withdraw')) / 1e6;
        const withdrawn = parseFloat(values.get('withdrawn')) / 1e6;
        const vesting_shares = assetFloat(
            values.get('vesting_shares'),
            VEST_TICKER
        );
        const delegated_vesting_shares = assetFloat(
            values.get('delegated_vesting_shares'),
            VEST_TICKER
        );
        const available_shares =
            vesting_shares - to_withdraw - withdrawn - delegated_vesting_shares;

        const routes = state.user.get('withdraw_routes');

        const withdraw_routes = routes && routes.toJS ? routes.toJS() : [];

        return {
            ...ownProps,
            account,
            available_shares,
            delegated_vesting_shares,
            state,
            to_withdraw,
            vesting_shares,
            withdrawn,
            withdraw_routes,
        };
    },
    // mapDispatchToProps
    dispatch => ({
        successCallback: () => {
            dispatch(userActions.hidePowerdown());
        },
        powerDown: e => {
            e.preventDefault();
            const name = 'powerDown';
            dispatch(globalActions.showDialog({ name }));
        },
        withdrawVesting: ({
            account,
            vesting_shares,
            equalSp,
            errorCallback,
            successCallback,
        }) => {
            const successCallbackWrapper = (...args) => {
                userActionRecord('withdraw_vesting', {
                    username: account,
                    amount: equalSp,
                });
                dispatch(
                    globalActions.getState({ url: `@${account}/transfers` })
                );
                return successCallback(...args);
            };
            dispatch(
                transactionActions.broadcastOperation({
                    type: 'withdraw_vesting',
                    operation: { account, vesting_shares },
                    errorCallback,
                    successCallback: successCallbackWrapper,
                })
            );
        },
    })
)(Powerdown);
