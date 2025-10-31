import React from 'react';
import reactForm from 'app/utils/ReactForm';
import { connect } from 'react-redux';
import tt from 'counterpart';
import shouldComponentUpdate from 'app/utils/shouldComponentUpdate';
import * as transactionActions from 'app/redux/TransactionReducer';
import * as userActions from 'app/redux/UserReducer';
import * as globalActions from 'app/redux/GlobalReducer';
import Icon from 'app/components/elements/Icon';
import { FormattedHTMLMessage } from 'app/Translator';
import { validate_account_name } from 'app/utils/ChainValidation';
import ConfirmWithdrawVestingRoute from 'app/components/elements/ConfirmWithdrawVestingRoute';
import LoadingIndicator from 'app/components/elements/LoadingIndicator';
import { api } from '@steemit/steem-js';

class RouteSettings extends React.Component {
    constructor(props) {
        super(props);
        this.shouldComponentUpdate = shouldComponentUpdate(this, 'RouteSettings');
        this.state = {
            errorMessage: undefined,
            remainingPercentage: 100,
            maxWithdrawRoutes: 10,
        };
        this.initForm(props);
    }

    async componentWillMount() {
        this.updateRemainingPercentage(this.props.withdraw_routes);
        await this.fetchConfig()
    }

    fetchConfig() {
        api.callAsync('database_api.get_config', {})
            .then(res => {
                this.setState({
                    maxWithdrawRoutes: res.STEEM_MAX_WITHDRAW_ROUTES
                });
            })
            .catch(err => {
                console.error('Error fetching config:', err);
            });
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

    removeWithdrawRoute = (toAccount) => {
        this.setState({ loading: true, errorMessage: undefined  });
        const { account, setWithdrawVestingRoute } = this.props;
        setWithdrawVestingRoute({
            account,
            proxy: toAccount,
            percent: 0,
            autoVest: false,
            successCallback: () => this.setState({ loading: false }),
            errorCallback: (error) => this.setState({ loading: false, errorMessage: String(error) }),
        });
    };

    setWithdrawRoute = () => {
        this.setState({ loading: true, errorMessage: undefined });
        const { account, setWithdrawVestingRoute, hideModal } = this.props;
        const { to, percentage, asset } = this.state;

        setWithdrawVestingRoute({
            account,
            proxy: to.value,
            percent: Math.round(percentage.value * 100), // API expects percentage * 100
            autoVest: asset.value === 'SP',
            successCallback: () => {
                this.setState({ loading: false });
                to.props.onChange('')
                percentage.props.onChange(0)
                // hideModal();
            },
            errorCallback: (error) => {
                this.setState({ loading: false, errorMessage: String(error) });
            },
        });
    };

    validatePercentage = (percentage, remainingPercentage, to) =>  {
        const { withdraw_routes } = this.props;
        const withdrawRoutes = withdraw_routes && withdraw_routes.length > 0
            ? withdraw_routes
            : [];
        if (remainingPercentage <= 0) {
            return null
        }
        if (!percentage || isNaN(percentage)) {
            return 'Percentage is required and must be a number.';
        }
        const percentageFloat = parseFloat(percentage);
        if (percentageFloat <= 0 || percentageFloat > 100) {
            return `Percentage must be greater than 0 and less than or equal to ${100}.`;
        }
        const existingRoute = withdrawRoutes.find(route => route.to_account === to);
        if (existingRoute) {
            const updatedRemaining = remainingPercentage + (existingRoute.percent / 100);
            if (percentageFloat > updatedRemaining) {
                return `Only ${updatedRemaining}% is left.`;
            }
        } else {
            if (percentageFloat > remainingPercentage) {
                return `Only ${remainingPercentage}% is left.`;
            }
        }
        return null;
    }

    onChangeTo = async value => {
        const cleanValue = value.replace(/\s+/g, '');
        this.state.to.props.onChange(cleanValue);
    };

    initForm(props) {
        const fields = ['percentage', 'to','asset'];
        const validate = values => {
            const { remainingPercentage } = this.state;
            return {
                percentage: this.validatePercentage(values.percentage, remainingPercentage, values.to ),
                to: validate_account_name(values.to),
            };
        };
        reactForm({
            name: 'routeSettings',
            instance: this,
            fields,
            initialValues: { percentage: 0, to: '', asset: 'STEEM' },
            validation: validate,
        });
    }

    render() {
        if (!this.props.account) return null;
        const { remainingPercentage, maxWithdrawRoutes, errorMessage, to, percentage, asset, loading } = this.state;
        const { withdraw_routes, hideModal, account } = this.props;
        const { valid, handleSubmit, submitting } = this.state.routeSettings;

        const sortedRoutes = withdraw_routes && withdraw_routes.length > 0
            ? [...withdraw_routes].sort((a, b) => b.percent - a.percent)
            : [];

        const currentRoutesList = sortedRoutes.map(route => {
            return (
                <tr key={route.to_account}>
                    <td>
                        <a href={`/@${route.to_account}`} style={{ color: '#1FBF8F' }} target="_blank">
                            {route.to_account}
                        </a>
                    </td>
                    <td>{route.percent / 100}%</td>
                    <td>{route.auto_vest ? tt('advanced_routes.steem_power') : tt('advanced_routes.steem')}</td>
                    <td style={{ textAlign: "center", whiteSpace: 'nowrap', width: '1%' }}>
                        <div
                            style={{ cursor: 'pointer', margin: 0, padding: 0 }}
                            onClick={() => this.removeWithdrawRoute(route.to_account)}
                            title={tt('g.remove')}
                            disabled={loading}
                        >
                            <span style={{ fontSize: '1.5rem', fontWeight: 'bold', lineHeight: '1rem' }}>
                                &times;
                            </span>
                        </div>
                    </td>
                </tr>
            );
        });
        const remainingRoutes = maxWithdrawRoutes - sortedRoutes.length

        const currentRoutes = (
            <div className="WithdrawRoutes column small-12">
                <h5 style={{ marginBottom: '0.25rem' }}>{tt('advanced_routes.current_routes', { accounts_number: (remainingRoutes) })}</h5>

                {sortedRoutes && sortedRoutes.length > 0 ? (
                    <div style={{ overflowX: "auto", marginBottom: "1rem" }}>
                        <table className="table">
                            <thead>
                                <tr>
                                    <th>{tt('advanced_routes.account')}</th>
                                    <th>{tt('advanced_routes.percentage')}</th>
                                    <th>{tt('advanced_routes.receive')}</th>
                                    <th style={{ whiteSpace: 'nowrap', width: '1%' }}>{tt('advanced_routes.remove')}</th>
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
                                    <td>{tt('advanced_routes.steem')}</td>
                                    <td style={{ textAlign: "center", whiteSpace: 'nowrap', width: '1%' }}>
                                    </td>
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


        return (
            <div>
                <div className="row">
                    <h3 className="column">
                        {tt('userwallet_jsx.set_advanced_routes')}
                    </h3>
                </div>

                <form onSubmit={handleSubmit(({ data }) => {
                        this.setWithdrawRoute();
                    })}>
                    <div>
                        <div className="row">
                            <div className="column small-12">
                                <FormattedHTMLMessage
                                    className="secondary"
                                    id="userwallet_jsx.advanced_routes_visit_faq"
                                />
                            </div>
                        </div>
                        <br />
                    </div>
                    <div className="row">
                        <div className="column flex-container-1" style={{ paddingTop: 5 }}>
                            {tt('advanced_routes.from')}
                        </div>
                        <div className="column flex-container-2">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <span className="input-group-label">@</span>
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    disabled
                                    value={account}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="row">
                        <div className="column flex-container-1" style={{ paddingTop: 5 }}>
                            {tt('advanced_routes.to')}
                        </div>
                        <div className="column flex-container-2">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <span className="input-group-label">@</span>
                                <input
                                    className="input-group-field bold"
                                    type="text"
                                    ref="to"
                                    name="to"
                                    {...to.props}
                                    disabled={loading}
                                    onChange={async e => {
                                        await this.onChangeTo(e.target.value);
                                    }}
                                />
                            </div>
                        </div>
                        {(to && to.touched && to.error) ? (
                            <div className="column small-12 callout alert">
                                {to &&
                                    to.touched &&
                                    to.error &&
                                    to.error}&nbsp;
                            </div>
                        ) : null}
                    </div>
                    <div className="row">
                        <div className="column flex-container-1" style={{ paddingTop: 5 }}>
                            {tt('advanced_routes.percentage')}
                        </div>
                        <div className="column flex-container-2">
                            <div
                                className="input-group"
                                style={{ marginBottom: '1.25rem' }}
                            >
                                <input
                                    type="number"
                                    name="percentage"
                                    ref="percentage"
                                    {...percentage.props}
                                    min="0"
                                    max={100}
                                    disabled={loading}
                                />
                                {asset && asset.value && (
                                    <span
                                        className="input-group-label"
                                        style={{
                                            paddingLeft: 0,
                                            paddingRight: 0,
                                        }}
                                    >
                                        <select
                                            {...asset.props}
                                            disabled={loading}
                                            style={{
                                                minWidth: '5rem',
                                                height: 'inherit',
                                                backgroundColor: 'transparent',
                                                border: 'none',
                                            }}
                                        >
                                            <option value="STEEM">{tt("advanced_routes.steem")}</option>
                                            <option value="SP">{tt("advanced_routes.steem_power")}</option>
                                        </select>
                                    </span>
                                )}
                            </div>
                        </div>
                        {(percentage && percentage.touched && percentage.error) ? (
                            <div className="column small-12 callout alert">
                                {percentage &&
                                    percentage.touched &&
                                    percentage.error &&
                                    percentage.error}&nbsp;
                            </div>
                        ) : null}

                        {(remainingRoutes <= 0 || remainingPercentage <= 0) && (<div className="column small-12 callout alert">
                            {remainingRoutes <= 0 && tt('advanced_routes.not_remaining_routes')}
                            {(remainingRoutes <= 0 && remainingPercentage <= 0) && <br />}
                            {remainingPercentage <= 0 && tt('advanced_routes.not_remaining_percentage')}
                        </div>)}
                    </div>
                    {currentRoutes}
                    {errorMessage && (
                        <div className="row">
                            <div className="column small-12 callout alert">
                                {errorMessage}
                            </div>
                        </div>
                    )}
                    <div className="row">
                         <div className="column">
                            {loading && (
                                <span>
                                    <LoadingIndicator type="circle" />
                                    <br />
                                </span>
                            )}
                            {!loading && (
                                <span>
                                    <button
                                        type="submit"
                                        disabled={
                                            submitting ||
                                            !valid ||
                                            remainingRoutes <= 0 ||
                                            remainingPercentage <= 0
                                        }
                                        className="button"
                                    >
                                        {tt('g.next')}
                                    </button>
                                </span>
                            )}
                        </div>
                    </div>
                </form>
            </div>
        );
    }
}

export default connect(
    (state, ownProps) => {
        const values = state.user.get('advanced_defaults');
        if (!values) return { ...ownProps, account: null, withdraw_routes: [] };

        const accountName = values.get('account');
        const routes = state.user.get('withdraw_routes');

        const withdraw_routes = routes && routes.toJS ? routes.toJS() : [];

        return {
            ...ownProps,
            account: accountName,
            withdraw_routes,
        };
    },
    (dispatch) => ({
        hideModal: () => {
            dispatch(userActions.hideAdvanced());
        },
        setWithdrawVestingRoute: ({
            account,
            proxy,
            percent,
            autoVest,
            successCallback,
            errorCallback,
        }) => {
             const successCallbackWrapper = (...args) => {
                // Refresh account data after transaction
                dispatch(userActions.getWithdrawRoutes({ account }));
                if (successCallback) return successCallback(...args);
            };
            const confirm = () => (
                <ConfirmWithdrawVestingRoute
                    operation={{
                        from: account,
                        to: proxy,
                        percentage: percent / 100,
                        asset: autoVest,
                    }} />
            );
            const isRemove = percent === 0;
             dispatch(
                transactionActions.broadcastOperation({
                    type: 'set_withdraw_vesting_route',
                    operation: {
                        from_account: account,
                        to_account: proxy,
                        percent: percent,
                        auto_vest: autoVest,
                    },
                    confirm,
                    successCallback: successCallbackWrapper,
                    errorCallback,
                })
            );
        },
    })
)(RouteSettings);
