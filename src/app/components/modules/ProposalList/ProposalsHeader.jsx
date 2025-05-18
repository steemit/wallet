import React, { Component } from 'react';
import tt from 'counterpart';

export default class ProposalsHeader extends Component {
    render() {
        const {
            status,
            orderBy,
            orderDirection,
            onFilter,
            onOrder,
            onOrderDirection,
            triggerCreatorsModal,
            daoTreasury,
            dailyBudget,
        } = this.props;

        return (
            <div>
                <div>
                    {(daoTreasury || dailyBudget) && (
                        <div className="proposals__header__info">
                            {daoTreasury && (
                                <div className="proposals__header__info__item">
                                    <span>{tt('proposals.dao_treasury')}</span>
                                    <span>{`${daoTreasury} SBD`}</span>
                                </div>
                            )}
                            {dailyBudget && (
                                <div className="proposals__header__info__item">
                                    <span>{tt('proposals.daily_budget')}</span>
                                    <span>{`${dailyBudget} SBD`}</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>
                <div className="proposals__header">
                    <div className="proposals__title">
                        {tt('proposals.title')}
                    </div>
                    <div className="proposals__filters">
                        <span className="proposals__select">
                            {tt('proposals.status')}
                            <select
                                value={status}
                                onChange={e => onFilter(e.target.value)}
                            >
                                <option value="all">
                                    {tt('proposals.status_options.all')}
                                </option>
                                <option value="active">
                                    {tt('proposals.status_options.active')}
                                </option>
                                <option value="inactive">
                                    {tt('proposals.status_options.inactive')}
                                </option>
                                <option value="expired">
                                    {tt('proposals.status_options.expired')}
                                </option>
                                <option value="votable">
                                    {tt('proposals.status_options.votable')}
                                </option>
                            </select>
                        </span>
                        <span className="proposals__select">
                            {tt('proposals.order')}
                            <select
                                value={orderBy}
                                onChange={e => onOrder(e.target.value)}
                            >
                                <option value="by_creator">
                                    {tt('proposals.order_options.creator')}
                                </option>
                                <option value="by_start_date">
                                    {tt('proposals.order_options.start_date')}
                                </option>
                                <option value="by_end_date">
                                    {tt('proposals.order_options.end_date')}
                                </option>
                                <option value="by_total_votes">
                                    {tt('proposals.order_options.total_votes')}
                                </option>
                            </select>
                        </span>
                        <div
                            role="button"
                            tabIndex={0}
                            className="proposals__order_direction"
                            onClick={() => {
                                const newDirection =
                                    orderDirection === 'ascending'
                                        ? 'descending'
                                        : 'ascending';
                                onOrderDirection(newDirection);
                            }}
                        >
                            <div
                                className={`direction ${
                                    orderDirection === 'ascending'
                                        ? 'active'
                                        : ''
                                }`}
                            >
                                &#x2191;
                            </div>
                            <div
                                className={`direction ${
                                    orderDirection === 'descending'
                                        ? 'active'
                                        : ''
                                }`}
                            >
                                &#x2193;
                            </div>
                        </div>
                        <div
                            role="button"
                            tabIndex={0}
                            onClick={triggerCreatorsModal}
                            className="button primary"
                        >
                            {tt('proposals.create')}
                        </div>
                    </div>
                </div>
            </div>
        );
    }
}
